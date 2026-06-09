"""
admin.py — Internal endpoints for the auto-fixer.

All endpoints require the X-Admin-Token header to match settings.admin_token.
If ADMIN_TOKEN is unset on the server, every admin endpoint returns 503 —
this prevents accidental exposure in production.

POST /admin/auto-fix          Trigger a fixer run immediately
GET  /admin/auto-fix/log      Return the tail of auto_fix.log as plain text
GET  /admin/auto-fix/status   Return next scheduled run + last run summary
"""

import secrets
from typing import Optional

from fastapi import APIRouter, Depends, Header, HTTPException, status
from fastapi.responses import PlainTextResponse

from app.config import settings
from app.services.auto_fixer import run_auto_fixer, read_log

router = APIRouter(prefix="/admin", tags=["admin"])

_last_run: Optional[dict] = None
_next_run_at: Optional[str] = None


def require_admin(x_admin_token: Optional[str] = Header(default=None)) -> None:
    """Validate the X-Admin-Token header against settings.admin_token.

    Returns 503 if no admin token is configured on the server (refuse rather
    than allow), and 401 if the header is missing or doesn't match.
    """
    if not settings.admin_token:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Admin endpoints disabled — ADMIN_TOKEN not configured.",
        )
    if not x_admin_token or not secrets.compare_digest(x_admin_token, settings.admin_token):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or missing X-Admin-Token.",
        )


@router.post("/auto-fix", dependencies=[Depends(require_admin)])
async def trigger_auto_fix():
    """Kick off a fixer run right now and return its summary."""
    global _last_run
    try:
        summary = await run_auto_fixer()
        _last_run = summary
        return summary
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.get("/auto-fix/log", response_class=PlainTextResponse,
            dependencies=[Depends(require_admin)])
def get_log():
    """Return the last 50 KB of auto_fix.log as plain text."""
    return read_log()


@router.get("/auto-fix/status", dependencies=[Depends(require_admin)])
def get_status():
    """Return when the next run is scheduled and what the last run produced."""
    return {
        "next_run_at": _next_run_at,
        "last_run":    _last_run,
        "enabled":     settings.auto_fixer_enabled,
        "interval_h":  settings.auto_fixer_interval_hours,
    }


def set_next_run_at(iso: str):
    """Called by the scheduler loop to update the next-run timestamp."""
    global _next_run_at
    _next_run_at = iso
