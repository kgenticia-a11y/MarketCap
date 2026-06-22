"""Shared Anthropic Claude client used by every AI co-pilot feature
(portfolio analysis, daily brief, chart analysis, earnings briefs, chat).

Centralised here so every endpoint shares one model constant, one timeout
policy, and one error type — callers just catch ClaudeNotConfigured /
ClaudeRequestError and map them to the right HTTP status.
"""
import asyncio
import logging

from app.config import settings

logger = logging.getLogger(__name__)

CLAUDE_MODEL = "claude-sonnet-4-5-20250929"


class ClaudeNotConfigured(Exception):
    """Raised when ANTHROPIC_API_KEY is not set on the server."""


class ClaudeRequestError(Exception):
    """Raised when the Anthropic API call itself fails."""


async def ask_claude(
    system: str,
    messages: list[dict[str, str]],
    max_tokens: int = 1024,
) -> str:
    """Send a system prompt + conversation turns to Claude, return the text reply.

    `messages` is a list of {"role": "user"|"assistant", "content": str} dicts,
    Anthropic Messages API style.
    """
    if not settings.anthropic_api_key:
        raise ClaudeNotConfigured()

    try:
        import anthropic
    except ImportError as exc:
        raise ClaudeRequestError("Anthropic SDK not installed.") from exc

    client = anthropic.Anthropic(api_key=settings.anthropic_api_key)
    try:
        response = await asyncio.to_thread(
            client.messages.create,
            model=CLAUDE_MODEL,
            max_tokens=max_tokens,
            system=system,
            messages=messages,
        )
    except Exception as exc:
        logger.error("Claude API call failed: %s", exc)
        raise ClaudeRequestError(str(exc)) from exc

    text = "".join(block.text for block in response.content if block.type == "text").strip()
    if not text:
        raise ClaudeRequestError("Claude returned an empty response.")
    return text


async def ask_claude_text(system: str, prompt: str, max_tokens: int = 1024) -> str:
    """Convenience wrapper for single-turn (non-chat) prompts."""
    return await ask_claude(system, [{"role": "user", "content": prompt}], max_tokens)
