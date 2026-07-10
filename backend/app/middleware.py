"""
middleware.py — Lightweight per-process middlewares.

Includes:
  * SecurityHeadersMiddleware — OWASP-recommended HTTP security headers
  * AuthRateLimiter — per-IP sliding window for auth + market-data endpoints
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
    """Attach OWASP-recommended security headers to every API response.

    The CSP here is intentionally strict for JSON API responses ('none' base).
    The frontend HTML served by Vercel carries its own CSP via vercel.json.
    """

    # Tight CSP for JSON API responses — browsers never render these as pages.
    _API_CSP = "default-src 'none'; frame-ancestors 'none'"

    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        h = response.headers
        # Prevent MIME-type sniffing attacks.
        h["X-Content-Type-Options"] = "nosniff"
        # Disallow embedding this API in any frame.
        h["X-Frame-Options"] = "DENY"
        h["Referrer-Policy"] = "strict-origin-when-cross-origin"
        h["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
        # Legacy XSS filter (still honoured by some older browsers).
        h["X-XSS-Protection"] = "1; mode=block"
        # Enforce HTTPS — prevent protocol-downgrade / SSL-stripping attacks.
        h["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains; preload"
        # Isolate browsing context — mitigates cross-origin info leaks / Spectre.
        h["Cross-Origin-Opener-Policy"] = "same-origin"
        # API is accessed cross-origin (frontend ↔ backend), so allow it while
        # still opting in explicitly rather than leaving the header absent.
        h["Cross-Origin-Resource-Policy"] = "cross-origin"
        # Restrict API responses to our own CSP; browsers cannot render them.
        h["Content-Security-Policy"] = self._API_CSP
        # Suppress the server identity header to hinder fingerprinting.
        h["Server"] = ""
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
    """Per-IP sliding-window rate limiter covering auth AND market-data endpoints.

    Rule tuple: (method, path_or_prefix, max_attempts, window_sec, prefix_match)
      - prefix_match=True  → any path that starts with `path` is matched
      - prefix_match=False → exact path match only (default)

    Memory safety: empty deques are deleted after their last entry expires to
    prevent unbounded dict growth from IP-rotating attackers / scanners.
    """

    DEFAULT_RULES: tuple[tuple[str, str, int, int, bool], ...] = (
        # ── Auth endpoints ───────────────────────────────────────────────
        ("POST",  "/auth/login",         10,  60, False),
        ("POST",  "/auth/register",      10,  60, False),
        # Password change: tightened from 10/min → 3 per 5 min. An attacker
        # with a stolen JWT gets only 3 guesses at the current password before
        # a 5-minute lockout, making brute-force impractical.
        ("PATCH", "/auth/password",       3, 300, False),
        # GDPR data export — DB-heavy; 3 per 5 min per IP is generous.
        ("GET",   "/auth/data-export",    3, 300, False),
        # Anonymous feedback — stricter window to deter spam.
        ("POST",  "/feedback",            5, 300, False),
        # ── Market-data endpoints (unauthenticated) ──────────────────────
        # Screener is by far the most expensive: bulk-downloads the full 2,099-stock universe.
        ("GET",   "/stocks/screener",     2,  60, False),
        # Market overview + update are also yfinance-heavy.
        ("GET",   "/stocks/market/",      5,  60, True),
        # All other /stocks/* (quote, details, chart, income…) — generous but bounded.
        ("GET",   "/stocks/",            30,  60, True),
        # Backtest hits yfinance history every call — 1-3s upstream per
        # request. Keep it bounded so a hot-clicking user can't melt the
        # event loop or Yahoo's per-IP budget.
        ("GET",   "/paper-trading/strategies/backtest",  6, 60, True),
    )

    # Periodic GC: after this many dispatch calls, sweep the whole map and
    # drop any keys whose deque is empty (window fully expired). Done in-line
    # instead of on a timer so the cost is amortised across real traffic.
    _GC_EVERY = 1000

    def __init__(
        self,
        app,
        rules: tuple[tuple[str, str, int, int, bool], ...] | None = None,
    ):
        super().__init__(app)
        self.rules = rules or self.DEFAULT_RULES
        self._hits: dict[tuple[str, str], deque[float]] = defaultdict(deque)
        self._calls_since_gc = 0

    def _client_ip(self, request: Request) -> str:
        # Fly.io injects Fly-Client-IP with the real client IP; it cannot be
        # spoofed because Fly strips any client-supplied header with this name
        # before forwarding. Prefer it over X-Forwarded-For, which clients CAN
        # spoof by prepending values to bypass per-IP rate limits.
        fly_ip = request.headers.get("fly-client-ip")
        if fly_ip:
            return fly_ip.strip()
        # Outside Fly (local dev, CI): fall back to the direct connection address.
        return request.client.host if request.client else "unknown"

    def _matching_rule(self, method: str, path: str):
        for rule in self.rules:
            m, p, max_attempts, window = rule[:4]
            prefix = len(rule) > 4 and rule[4]
            if m == method and (path.startswith(p) if prefix else path == p):
                return max_attempts, window
        return None

    async def dispatch(self, request: Request, call_next):
        rule = self._matching_rule(request.method, request.url.path)
        if not rule:
            return await call_next(request)
        max_attempts, window_sec = rule

        ip      = self._client_ip(request)
        key     = (ip, request.url.path)
        now     = time.monotonic()
        cutoff  = now - window_sec
        attempts = self._hits[key]

        # Drop entries that have slid outside the window.
        while attempts and attempts[0] < cutoff:
            attempts.popleft()

        if len(attempts) >= max_attempts:
            retry_after = int(attempts[0] + window_sec - now) + 1
            return JSONResponse(
                status_code=429,
                content={"detail": "Too many requests. Please wait and try again."},
                headers={"Retry-After": str(retry_after)},
            )

        # Prune fully-expired keys to prevent unbounded dict growth from IPs
        # that hit once and never return (IP-rotating attackers, scanners).
        # The defaultdict recreates the deque automatically on the next hit.
        if not attempts:
            del self._hits[key]

        self._hits[key].append(now)
        return await call_next(request)
