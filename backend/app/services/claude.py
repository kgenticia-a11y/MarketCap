"""Shared AI client used by every AI co-pilot feature
(portfolio analysis, daily brief, chart analysis, earnings briefs, chat).

Uses Meta Llama 3.3 70B via Groq's free inference API. Centralised here so
every endpoint shares one model constant, one timeout policy, one retry
policy, and one error taxonomy — callers just catch AINotConfigured /
AIRateLimited / AIRequestError and map them to the right HTTP status.

Guardrails baked into this layer (so no endpoint can forget them):
  * Every request carries a hard timeout — a hung Groq connection can no
    longer pin a thread-pool slot indefinitely.
  * Transient failures (429 rate limits, 5xx, connection drops) are retried
    with bounded backoff, honouring Retry-After when Groq provides it. This
    is the permanent fix for the free-tier TPM/RPM errors that broke long
    analyst reports: most 429s resolve within one short wait, and the ones
    that don't surface as AIRateLimited → HTTP 429 with Retry-After instead
    of an opaque 502.
  * ai_guard.PROMPT_GUARD is appended to every system prompt, so every
    current AND future AI endpoint inherits the prompt-injection defense
    automatically.
"""
import asyncio
import logging
import random

from app.config import settings
from app.services import ai_guard

logger = logging.getLogger(__name__)

AI_MODEL = "llama-3.3-70b-versatile"

# Hard per-request timeout. Groq normally answers in a few seconds; anything
# past this is a hung connection, not a slow generation.
_REQUEST_TIMEOUT_SEC = 45.0

# Bounded retry policy for transient failures. The waits are short on purpose:
# these run inside a user-facing HTTP request, so we retry what resolves fast
# and convert the rest into a clean 429/502 for the client to handle.
_MAX_ATTEMPTS = 3
_MAX_BACKOFF_SEC = 10.0


class AINotConfigured(Exception):
    """Raised when GROQ_API_KEY is not set on the server."""


class AIRequestError(Exception):
    """Raised when the AI API call itself fails."""


class AIRateLimited(AIRequestError):
    """Raised when Groq rate limits persist through the retry budget.

    Carries retry_after (seconds) so the HTTP layer can return 429 with a
    Retry-After header instead of a generic 502.
    """

    def __init__(self, retry_after: int = 15):
        super().__init__("AI provider rate limit exceeded.")
        self.retry_after = retry_after


# Backward-compatible aliases so existing imports keep working during rollout.
ClaudeNotConfigured = AINotConfigured
ClaudeRequestError = AIRequestError

# One client for the process — connection reuse, and a single place where the
# timeout policy is set. SDK-internal retries are disabled because this module
# owns the retry policy (the SDK would otherwise retry blindly inside our own
# retry loop, multiplying the worst-case latency).
_client = None


def _get_client():
    global _client
    if _client is None:
        from groq import Groq  # noqa: PLC0415 — deferred so a missing SDK is a clean 502, not an import-time crash

        _client = Groq(
            api_key=settings.groq_api_key,
            timeout=_REQUEST_TIMEOUT_SEC,
            max_retries=0,
        )
    return _client


def _retry_after_seconds(exc: Exception) -> int | None:
    """Extract Retry-After from a Groq error response, if present."""
    response = getattr(exc, "response", None)
    headers = getattr(response, "headers", None)
    if not headers:
        return None
    value = headers.get("retry-after")
    try:
        return max(1, int(float(value)))
    except (TypeError, ValueError):
        return None


async def ask_claude(
    system: str,
    messages: list[dict[str, str]],
    max_tokens: int = 1024,
) -> str:
    """Send a system prompt + conversation turns to the AI model, return the text reply.

    `messages` is a list of {"role": "user"|"assistant", "content": str} dicts.
    Uses Groq's OpenAI-compatible chat completions API with Meta Llama.
    """
    if not settings.groq_api_key:
        raise AINotConfigured()

    try:
        client = _get_client()
    except ImportError as exc:
        raise AIRequestError("Groq SDK not installed.") from exc

    api_messages: list[dict[str, str]] = [
        {"role": "system", "content": system + ai_guard.PROMPT_GUARD}
    ]
    api_messages.extend(messages)

    last_exc: Exception | None = None
    for attempt in range(1, _MAX_ATTEMPTS + 1):
        try:
            response = await asyncio.to_thread(
                client.chat.completions.create,
                model=AI_MODEL,
                messages=api_messages,
                max_tokens=max_tokens,
            )
            break
        except Exception as exc:
            last_exc = exc
            status = getattr(exc, "status_code", None)
            rate_limited = status == 429
            transient = rate_limited or (isinstance(status, int) and status >= 500) or status is None
            if not transient or attempt == _MAX_ATTEMPTS:
                logger.error(
                    "Groq API call failed (attempt %d/%d, status=%s): %s",
                    attempt, _MAX_ATTEMPTS, status, exc,
                )
                if rate_limited:
                    raise AIRateLimited(_retry_after_seconds(exc) or 15) from exc
                raise AIRequestError(str(exc)) from exc
            # Honour Retry-After when Groq sends one, otherwise exponential
            # backoff with jitter; either way cap the wait so a user request
            # never hangs on retries longer than it would on a cold timeout.
            wait = _retry_after_seconds(exc) or (2 ** attempt) * (0.5 + random.random() / 2)
            wait = min(float(wait), _MAX_BACKOFF_SEC)
            logger.warning(
                "Groq API transient failure (attempt %d/%d, status=%s) — retrying in %.1fs",
                attempt, _MAX_ATTEMPTS, status, wait,
            )
            await asyncio.sleep(wait)
    else:  # pragma: no cover — loop always breaks or raises
        raise AIRequestError(str(last_exc))

    text = (response.choices[0].message.content or "").strip() if response.choices else ""
    if not text:
        raise AIRequestError("AI model returned an empty response.")
    return text


async def ask_claude_text(system: str, prompt: str, max_tokens: int = 1024) -> str:
    """Convenience wrapper for single-turn (non-chat) prompts."""
    return await ask_claude(system, [{"role": "user", "content": prompt}], max_tokens)
