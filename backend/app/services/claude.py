"""Shared AI client used by every AI co-pilot feature
(portfolio analysis, daily brief, chart analysis, earnings briefs, chat).

Uses Groq's free inference API. Centralised here so every endpoint shares
one model policy, one timeout policy, one retry policy, and one error
taxonomy — callers just catch AINotConfigured / AIRateLimited /
AIRequestError and map them to the right HTTP status.

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
  * The model is NOT a single hardcoded constant. Groq retires free-tier
    models on short notice (llama-3.3-70b-versatile — the previous
    hardcoded model — was deprecated on 2026-06-17, which silently broke
    every AI feature at once with 'model_decommissioned' 400s). The client
    now walks an ordered candidate list: when the provider reports a model
    as decommissioned/not found, that model is marked dead for the process
    and the next candidate is tried on the same request. GROQ_MODEL in the
    environment overrides the default primary without a code change.
"""
import asyncio
import logging
import random
import threading

from app.config import settings
from app.services import ai_guard

logger = logging.getLogger(__name__)

# Ordered fallback chain. First entry is the preferred model; later entries
# are only used after the provider reports an earlier one as decommissioned
# or unknown. Keep at least two currently-served Groq production models here.
#   - openai/gpt-oss-120b and qwen/qwen3.6-27b are Groq's own recommended
#     replacements for the retired llama-3.3-70b-versatile.
#   - llama-3.3-70b-versatile stays last: it still serves for enterprise
#     committed-spend accounts, so it remains a valid final fallback.
_DEFAULT_MODEL_CHAIN = [
    "openai/gpt-oss-120b",
    "qwen/qwen3.6-27b",
    "openai/gpt-oss-20b",
    "llama-3.3-70b-versatile",
]


def _model_candidates() -> list[str]:
    """GROQ_MODEL (if set) first, then the default chain, deduplicated."""
    chain = [settings.groq_model.strip()] if settings.groq_model.strip() else []
    for m in _DEFAULT_MODEL_CHAIN:
        if m not in chain:
            chain.append(m)
    return chain


# Models the provider has reported as decommissioned/unknown this process
# lifetime. Sticky so every later request starts directly at a live model;
# cleared only when the whole chain is exhausted (so a transient provider
# glitch can't permanently wedge the client until redeploy).
_dead_models: set[str] = set()
_dead_models_lock = threading.Lock()


def _active_model() -> str:
    with _dead_models_lock:
        for m in _model_candidates():
            if m not in _dead_models:
                return m
        # Every candidate has been marked dead — reset and start over rather
        # than failing forever (the marks may have been a transient outage).
        logger.error(
            "All AI model candidates were marked unavailable — resetting the "
            "fallback chain and retrying from the top."
        )
        _dead_models.clear()
        return _model_candidates()[0]


def _mark_model_dead(model: str) -> None:
    with _dead_models_lock:
        _dead_models.add(model)


def _is_model_unavailable(exc: Exception) -> bool:
    """True when the provider says the model itself is gone (vs. a transient
    failure): Groq returns 400 'model_decommissioned' for retired models and
    404 'model_not_found' for unknown ones."""
    status = getattr(exc, "status_code", None)
    if status not in (400, 404):
        return False
    code = ""
    body = getattr(exc, "body", None)
    if isinstance(body, dict):
        code = str((body.get("error") or {}).get("code", "")).lower()
    text = f"{code} {exc}".lower()
    return (
        "model_decommissioned" in text
        or "model_not_found" in text
        or "decommission" in text
        or ("model" in text and ("not found" in text or "does not exist" in text or "no longer supported" in text))
    )

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
    Uses Groq's OpenAI-compatible chat completions API. The model is chosen
    from the fallback chain above; a decommissioned model is skipped
    automatically on the same request.
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

    attempt = 0          # transient failures (rate limit / 5xx / network)
    model_swaps = 0      # decommissioned-model fallbacks — bounded separately
    while True:
        model = _active_model()
        try:
            response = await asyncio.to_thread(
                client.chat.completions.create,
                model=model,
                messages=api_messages,
                max_tokens=max_tokens,
            )
            break
        except Exception as exc:
            status = getattr(exc, "status_code", None)

            # A retired/unknown model is a configuration failure, not a
            # transient one: mark it dead for the process and retry the SAME
            # request on the next candidate immediately (no backoff — the
            # provider answered fast and the next model is independent).
            if _is_model_unavailable(exc):
                _mark_model_dead(model)
                model_swaps += 1
                if model_swaps >= len(_model_candidates()):
                    logger.error("Every AI model candidate is unavailable: %s", exc)
                    raise AIRequestError(f"No available AI model: {exc}") from exc
                logger.error(
                    "AI model %r reported unavailable by provider (status=%s) — "
                    "falling back to %r. Update GROQ_MODEL to silence this.",
                    model, status, _active_model(),
                )
                continue

            attempt += 1
            rate_limited = status == 429
            transient = rate_limited or (isinstance(status, int) and status >= 500) or status is None
            if not transient or attempt >= _MAX_ATTEMPTS:
                logger.error(
                    "Groq API call failed (model=%s, attempt %d/%d, status=%s): %s",
                    model, attempt, _MAX_ATTEMPTS, status, exc,
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
                "Groq API transient failure (model=%s, attempt %d/%d, status=%s) — retrying in %.1fs",
                model, attempt, _MAX_ATTEMPTS, status, wait,
            )
            await asyncio.sleep(wait)

    text = (response.choices[0].message.content or "").strip() if response.choices else ""
    if not text:
        raise AIRequestError("AI model returned an empty response.")
    return text


async def ask_claude_text(system: str, prompt: str, max_tokens: int = 1024) -> str:
    """Convenience wrapper for single-turn (non-chat) prompts."""
    return await ask_claude(system, [{"role": "user", "content": prompt}], max_tokens)
