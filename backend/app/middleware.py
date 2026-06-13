"""
middleware.py — Lightweight per-process middlewares.

Includes:
  * AuthRateLimiter — per-IP sliding window for auth endpoints
  * BodySizeLimiter — refuse oversized payloads early
  * RequestIDMiddleware — attaches a request ID to every response and log line

All state is per-process. For multi-instance deployments, swap to Redis.
"""

import logging
import time
import uuid
from collections import defaultdict, deque

from fastapi import Request
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

logger = logging.getLogger(__name__)


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """Attach standard security headers to every response."""

    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
        response.headers["X-XSS-Protection"] = "1; mode=block"
        return response


class RequestIDMiddleware(BaseHTTPMiddleware):
    """Generate / propagate an X-Request-ID per request and stamp it on the response."""

    async def dispatch(self, request: Request, call_next):
        rid = request.headers.get("x-request-id") or uuid.uuid4().hex[:12]
        # Stash on request.state so handlers + log filters can read it.
        request.state.request_id = rid
        response = await call_next(request)
        response.headers["X-Request-ID"] = rid
        return response


class BodySizeLimiter(BaseHTTPMiddleware):
    """Reject any request whose Content-Length exceeds max_bytes with 413."""

    def __init__(self, app, max_bytes: int):
        super().__init__(app)
        self.max_bytes = max_bytes

    async def dispatch(self, request: Request, call_next):
        cl = request.headers.get("content-length")
        if cl and cl.isdigit() and int(cl) > self.max_bytes:
            return JSONResponse(
                status_code=413,
                content={"detail": f"Payload too large (max {self.max_bytes} bytes)"},
            )
        return await call_next(request)


class AuthRateLimiter(BaseHTTPMiddleware):
    """Allow at most `max_attempts` requests per `window_sec` per IP
    to the protected paths. Auth endpoints and the anonymous feedback
    endpoint share this limiter so neither can be flooded."""

    # Each entry: (method, path, max_attempts, window_sec)
    DEFAULT_RULES: tuple[tuple[str, str, int, int], ...] = (
        ("POST", "/auth/login",    10, 60),
        ("POST", "/auth/register", 10, 60),
        ("PATCH", "/auth/password", 10, 60),
        # Anonymous feedback — stricter window to deter spam.
        ("POST", "/feedback",       5, 300),
    )

    def __init__(self, app, rules: tuple[tuple[str, str, int, int], ...] | None = None):
        super().__init__(app)
        self.rules = rules or self.DEFAULT_RULES
        self._hits: dict[tuple[str, str], deque[float]] = defaultdict(deque)

    def _client_ip(self, request: Request) -> str:
        # Fly.io injects Fly-Client-IP with the real client IP and it cannot
        # be spoofed by the client (Fly strips any client-supplied header with
        # this name before forwarding). Prefer it over X-Forwarded-For, which
        # clients CAN spoof by prepending values to bypass rate limiting.
        fly_ip = request.headers.get("fly-client-ip")
        if fly_ip:
            return fly_ip.strip()
        # Outside Fly (local dev, other proxies): fall back to the direct
        # connection address. Do NOT trust the first XFF value — it is
        # client-controlled and trivially spoofed.
        return request.client.host if request.client else "unknown"

    def _matching_rule(self, method: str, path: str):
        for m, p, max_attempts, window in self.rules:
            if m == method and p == path:
                return max_attempts, window
        return None

    async def dispatch(self, request: Request, call_next):
        rule = self._matching_rule(request.method, request.url.path)
        if not rule:
            return await call_next(request)
        max_attempts, window_sec = rule

        ip       = self._client_ip(request)
        key      = (ip, request.url.path)
        now      = time.monotonic()
        cutoff   = now - window_sec
        attempts = self._hits[key]

        # Drop expired entries
        while attempts and attempts[0] < cutoff:
            attempts.popleft()

        if len(attempts) >= max_attempts:
            retry_after = int(attempts[0] + window_sec - now) + 1
            return JSONResponse(
                status_code=429,
                content={"detail": "Too many requests. Please wait and try again."},
                headers={"Retry-After": str(retry_after)},
            )

        attempts.append(now)
        return await call_next(request)
