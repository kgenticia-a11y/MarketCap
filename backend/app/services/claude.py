"""Shared AI client used by every AI co-pilot feature
(portfolio analysis, daily brief, chart analysis, earnings briefs, chat).

Uses Meta Llama 3.3 70B via Groq's free inference API. Centralised here so
every endpoint shares one model constant, one timeout policy, and one error
type — callers just catch AINotConfigured / AIRequestError and map them to
the right HTTP status.
"""
import asyncio
import logging

from app.config import settings

logger = logging.getLogger(__name__)

AI_MODEL = "llama-3.3-70b-versatile"


class AINotConfigured(Exception):
    """Raised when GROQ_API_KEY is not set on the server."""


class AIRequestError(Exception):
    """Raised when the AI API call itself fails."""


# Backward-compatible aliases so existing imports keep working during rollout.
ClaudeNotConfigured = AINotConfigured
ClaudeRequestError = AIRequestError


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
        from groq import Groq
    except ImportError as exc:
        raise AIRequestError("Groq SDK not installed.") from exc

    client = Groq(api_key=settings.groq_api_key)

    api_messages: list[dict[str, str]] = [{"role": "system", "content": system}]
    api_messages.extend(messages)

    try:
        response = await asyncio.to_thread(
            client.chat.completions.create,
            model=AI_MODEL,
            messages=api_messages,
            max_tokens=max_tokens,
        )
    except Exception as exc:
        logger.error("Groq API call failed: %s", exc)
        raise AIRequestError(str(exc)) from exc

    text = (response.choices[0].message.content or "").strip() if response.choices else ""
    if not text:
        raise AIRequestError("AI model returned an empty response.")
    return text


async def ask_claude_text(system: str, prompt: str, max_tokens: int = 1024) -> str:
    """Convenience wrapper for single-turn (non-chat) prompts."""
    return await ask_claude(system, [{"role": "user", "content": prompt}], max_tokens)
