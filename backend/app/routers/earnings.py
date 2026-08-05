"""Earnings calendar and AI recap endpoints.

/earnings/calendar      — upcoming earnings for the user's tracked tickers
/earnings/recap/{ticker} — stored AI recap for a ticker (filtered by memo/date)
/earnings/recap/generate — on-demand recap generation (user auth + daily quota)
/internal/earnings-batch — called by the Supabase daily edge function
"""

import asyncio
import json
import logging
import os
from datetime import date, timedelta, datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Path, Query
from pydantic import BaseModel
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app import models, auth
from app.database import get_db
from app.services import market_data, claude, ai_guard

logger = logging.getLogger(__name__)

router = APIRouter(tags=["earnings"])

_TICKER_PATH = Path(..., min_length=1, max_length=10, pattern=r"^[A-Za-z0-9.\-]+$")

# Internal secret read from environment; edge function passes this in the
# X-Internal-Key header so the batch endpoint doesn't need user JWTs.
_INTERNAL_KEY = os.environ.get("INTERNAL_API_KEY", "")

# Cap on how many tickers the calendar endpoint fans out to yfinance per request,
# so a user tracking hundreds of names can't trigger hundreds of upstream calls.
_CALENDAR_TICKER_LIMIT = 40

_RECAP_SYSTEM = (
    "You are a financial analyst. Given a user's investment memo and the most "
    "recent quarterly earnings data for the company, analyse how the results "
    "affect the investment thesis. Be specific — reference the memo content "
    "directly. Return ONLY a JSON object, no markdown fences.\n"
    + ai_guard.PROMPT_GUARD
)


# ── Pydantic bodies ─────────────────────────────────────────────────────────

class RecapGenerateRequest(BaseModel):
    ticker: str
    memo_id: int
    earnings_date: str  # YYYY-MM-DD


class BatchTriggerRequest(BaseModel):
    """Sent by the Supabase edge function to trigger recap generation."""
    items: list[dict]  # [{ticker, memo_id, earnings_date, thesis_summary, ...}]


# ── AI error mapping ────────────────────────────────────────────────────────

def _ai_error_to_http(exc: Exception):
    if isinstance(exc, claude.AINotConfigured):
        raise HTTPException(503, "AI features are not configured on this server.")
    if isinstance(exc, claude.AIRateLimited):
        raise HTTPException(
            429,
            "The AI service is busy right now. Please try again in a moment.",
            headers={"Retry-After": str(exc.retry_after)},
        )
    if isinstance(exc, claude.AIRequestError):
        raise HTTPException(502, "AI request failed. Please try again.")
    raise exc


# ── Helper: generate recap for one memo ─────────────────────────────────────

async def _generate_recap(
    ticker: str,
    memo: models.InvestmentMemo,
    earnings_date: str,
) -> dict:
    """Build context from memo + yfinance earnings history, call AI, return recap dict."""
    fundamentals, earnings_hist = await asyncio.gather(
        market_data.get_fundamentals(ticker),
        market_data.get_ticker_earnings_history(ticker),
        return_exceptions=True,
    )
    if isinstance(fundamentals, Exception):
        fundamentals = {}
    if isinstance(earnings_hist, Exception):
        earnings_hist = []

    # Compose earnings history summary
    hist_lines = []
    for row in (earnings_hist or [])[:2]:
        q = row.get("quarter", "")
        ea = row.get("eps_actual")
        ee = row.get("eps_estimate")
        sp = row.get("surprise_pct")
        line = f"  {q}: EPS actual ${ea:.2f}" if ea is not None else f"  {q}: EPS actual N/A"
        if ee is not None:
            line += f" vs estimate ${ee:.2f}"
        if sp is not None:
            line += f" ({sp:+.1f}%)"
        hist_lines.append(line)

    earnings_ctx = "\n".join(hist_lines) if hist_lines else "No EPS history available."

    revenue_growth = fundamentals.get("revenue_growth_pct")
    earnings_growth = fundamentals.get("earnings_growth_pct")
    operating_margin = fundamentals.get("operating_margin_pct")

    fundamentals_ctx = (
        f"Revenue growth: {revenue_growth:.1f}%\n" if revenue_growth is not None else ""
    ) + (
        f"Earnings growth: {earnings_growth:.1f}%\n" if earnings_growth is not None else ""
    ) + (
        f"Operating margin: {operating_margin:.1f}%\n" if operating_margin is not None else ""
    )

    thesis_ctx = "\n".join(filter(None, [
        f"Thesis summary: {ai_guard.sanitize_text(memo.thesis_summary, 500)}" if memo.thesis_summary else None,
        f"Moat analysis: {ai_guard.sanitize_text(memo.moat_notes, 800)}" if memo.moat_notes else None,
        f"Financial health notes: {ai_guard.sanitize_text(memo.financial_health_notes, 800)}" if memo.financial_health_notes else None,
        f"Risks noted: {ai_guard.sanitize_text(memo.risks, 500)}" if memo.risks else None,
    ]))

    prompt = f"""Company: {ticker}
Earnings date: {earnings_date}

Recent EPS history:
{earnings_ctx}

Current fundamentals:
{fundamentals_ctx or "No fundamentals data available."}

The user's investment memo thesis:
{thesis_ctx or "No thesis content recorded yet."}

Return a JSON object with exactly these keys:
{{
  "thesis_assessment": "<2-3 sentences analysing how the results affect the thesis>",
  "key_impact": "<one of: strengthens, weakens, neutral>",
  "key_impact_aspect": "<which specific aspect of the thesis is most affected>",
  "suggested_checkpoint_notes": "<pre-filled notes the user can save as a thesis checkpoint, 1-3 sentences>"
}}"""

    raw = await claude.ask_claude_text(
        system=_RECAP_SYSTEM,
        prompt=prompt,
        max_tokens=400,
    )

    # Parse and validate JSON
    raw = raw.strip()
    if raw.startswith("```"):
        raw = raw.split("```")[1]
        if raw.startswith("json"):
            raw = raw[4:]
    recap = json.loads(raw)

    # Validate expected keys
    for key in ("thesis_assessment", "key_impact", "key_impact_aspect", "suggested_checkpoint_notes"):
        if key not in recap:
            raise ValueError(f"AI response missing key: {key}")
    if recap["key_impact"] not in ("strengthens", "weakens", "neutral"):
        recap["key_impact"] = "neutral"

    # Sanitize text fields
    for key in ("thesis_assessment", "key_impact_aspect", "suggested_checkpoint_notes"):
        recap[key] = ai_guard.sanitize_text(str(recap[key]), max_len=1000)

    recap["generated_for_ticker"] = ticker
    recap["earnings_date"] = earnings_date
    return recap


async def _earnings_reported_near(
    ticker: str, earnings_date: str, window_days: int = 4
) -> bool:
    """True if the ticker actually reported earnings near `earnings_date`.

    The daily edge function sends every published memo with earnings_date set to
    yesterday and relies on this check — without it, because the recap uniqueness
    key is (memo_id, earnings_date) and the date advances daily, every memo would
    get a fresh AI recap (and a false "recap generated" notification) every day.

    yfinance's earnings_history is indexed by fiscal quarter-end dates, not
    announcement dates. US companies typically announce 15-95 days after the
    fiscal period ends, so we check whether any row with a confirmed actual EPS
    has its fiscal end within that lag window before `earnings_date`.
    """
    try:
        target = date.fromisoformat(earnings_date[:10])
    except (ValueError, TypeError):
        return False
    try:
        hist = await market_data.get_ticker_earnings_history(ticker)
    except Exception:
        return False
    for row in hist or []:
        q = row.get("quarter")
        # Only quarters with confirmed actuals count; estimated rows mean the
        # quarter hasn't been announced yet.
        if not q or row.get("eps_actual") is None:
            continue
        try:
            fiscal_end = date.fromisoformat(str(q)[:10])
        except ValueError:
            continue
        # Announcement lag: 15–95 days after fiscal quarter end covers virtually
        # all US reporting windows (SEC allows up to 75 days for large filers).
        days_lag = (target - fiscal_end).days
        if 15 <= days_lag <= 95:
            return True
    return False


# ── Endpoints ───────────────────────────────────────────────────────────────

@router.get("/earnings/calendar")
async def get_user_earnings_calendar(
    weeks: int = Query(4, ge=1, le=12),
    filter: str = Query("all", pattern=r"^(all|watchlist|portfolio|memos)$"),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    """Return upcoming earnings for the user's tracked tickers.

    Fetches yfinance calendar for each tracked ticker in parallel (concurrency
    limited to 5) and returns only those falling within `weeks` from today.

    The number of tickers fanned out is capped at `_CALENDAR_TICKER_LIMIT` so a
    user tracking hundreds of names can't trigger hundreds of upstream calendar
    fetches on one request. Tickers are prioritised memos > portfolio > watchlist
    (memos are the ones with thesis recaps, so most relevant to this view).
    """
    memo_list: list[str] = []
    portfolio_list: list[str] = []
    watchlist_list: list[str] = []

    if filter in ("all", "memos"):
        memo_list = [
            r[0] for r in
            db.query(models.InvestmentMemo.ticker).filter_by(user_id=current_user.id).distinct().all()
        ]

    if filter in ("all", "portfolio"):
        port_ids = [
            r[0] for r in
            db.query(models.Portfolio.id).filter_by(user_id=current_user.id).all()
        ]
        if port_ids:
            portfolio_list = [
                r[0] for r in
                db.query(models.PortfolioItem.ticker)
                .filter(models.PortfolioItem.portfolio_id.in_(port_ids))
                .distinct()
                .all()
            ]

    if filter in ("all", "watchlist"):
        watchlist_list = [
            r[0] for r in
            db.query(models.Watchlist.ticker).filter_by(user_id=current_user.id).all()
        ]

    # Deduplicate while preserving priority order, then cap the fan-out.
    ordered: list[str] = []
    seen: set[str] = set()
    for src in (memo_list, portfolio_list, watchlist_list):
        for t in src:
            if t not in seen:
                seen.add(t)
                ordered.append(t)
    tickers = ordered[:_CALENDAR_TICKER_LIMIT]

    if not tickers:
        return {"events": [], "tickers_checked": 0}

    # Check which tickers have published memos (for recap indicator)
    memo_tickers: set[str] = {
        r[0] for r in
        db.query(models.InvestmentMemo.ticker)
        .filter_by(user_id=current_user.id, status="published")
        .distinct()
        .all()
    }

    sem = asyncio.Semaphore(5)

    async def fetch_one(t: str) -> dict:
        async with sem:
            return await market_data.get_ticker_earnings_date(t)

    results = await asyncio.gather(
        *[fetch_one(t) for t in tickers],
        return_exceptions=True,
    )

    today = date.today()
    cutoff = today + timedelta(weeks=weeks)

    events = []
    for res in results:
        if isinstance(res, Exception) or not isinstance(res, dict):
            continue
        d_str = res.get("earnings_date")
        if not d_str:
            continue
        try:
            d = date.fromisoformat(d_str)
        except ValueError:
            continue
        if d < today or d > cutoff:
            continue
        t = res["ticker"]
        events.append({
            "ticker": t,
            "date": d_str,
            "date_end": res.get("earnings_date_end"),
            "eps_estimate": res.get("eps_estimate"),
            "revenue_estimate_b": res.get("revenue_estimate_b"),
            "has_memo": t in memo_tickers,
        })

    events.sort(key=lambda x: x["date"])
    return {"events": events, "tickers_checked": len(tickers)}


@router.get("/earnings/recap/{ticker}")
async def get_earnings_recap(
    ticker: str = _TICKER_PATH,
    memo_id: Optional[int] = Query(None),
    earnings_date: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    """Return the most recent stored AI recap for a ticker (optionally filtered).

    Only returns recaps for memos belonging to the calling user.
    """
    t = ticker.upper()

    # Find the user's memos for this ticker
    user_memo_ids = [
        r[0] for r in
        db.query(models.InvestmentMemo.id)
        .filter_by(user_id=current_user.id, ticker=t)
        .all()
    ]
    if not user_memo_ids:
        raise HTTPException(404, "No memo found for this ticker")

    query = (
        db.query(models.AIEarningsRecap)
        .filter(models.AIEarningsRecap.ticker == t)
        .filter(models.AIEarningsRecap.memo_id.in_(user_memo_ids))
    )
    if memo_id is not None:
        if memo_id not in user_memo_ids:
            raise HTTPException(403, "Memo does not belong to you")
        query = query.filter_by(memo_id=memo_id)
    if earnings_date:
        query = query.filter_by(earnings_date=earnings_date)

    recap = query.order_by(models.AIEarningsRecap.created_at.desc()).first()
    if not recap:
        raise HTTPException(404, "No recap found")

    return {
        "id": recap.id,
        "ticker": recap.ticker,
        "memo_id": recap.memo_id,
        "earnings_date": recap.earnings_date,
        "recap": json.loads(recap.recap_json),
        "created_at": recap.created_at.isoformat() if recap.created_at else None,
    }


@router.post("/earnings/recap/generate", status_code=201)
async def generate_earnings_recap(
    body: RecapGenerateRequest,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    """Generate and store an AI earnings recap on demand.

    Idempotent — returns existing recap if one already exists for this
    (memo_id, earnings_date) pair. The daily AI quota is only consumed on a
    genuine cache miss (i.e. when an AI call actually happens), so repeatedly
    opening a ticker with an existing recap never drains the user's budget.
    """
    t = body.ticker.upper()

    # Auth: memo must belong to calling user
    memo = (
        db.query(models.InvestmentMemo)
        .filter_by(id=body.memo_id, user_id=current_user.id, ticker=t)
        .first()
    )
    if not memo:
        raise HTTPException(404, "Memo not found or does not belong to you")

    # Check for existing recap
    existing = (
        db.query(models.AIEarningsRecap)
        .filter_by(memo_id=body.memo_id, earnings_date=body.earnings_date)
        .first()
    )
    if existing:
        return {
            "id": existing.id,
            "ticker": existing.ticker,
            "memo_id": existing.memo_id,
            "earnings_date": existing.earnings_date,
            "recap": json.loads(existing.recap_json),
            "created_at": existing.created_at.isoformat() if existing.created_at else None,
            "from_cache": True,
        }

    # Cache miss — now consume one AI quota unit.
    if not ai_guard.daily_quota.check_and_increment(current_user.id):
        raise HTTPException(
            429,
            "Daily AI usage limit reached. Your quota resets at midnight UTC.",
            headers={"Retry-After": "3600"},
        )

    # Double-check: a concurrent request may have inserted the recap between our
    # first check and the quota increment above, so re-verify before the AI call.
    existing = (
        db.query(models.AIEarningsRecap)
        .filter_by(memo_id=body.memo_id, earnings_date=body.earnings_date)
        .first()
    )
    if existing:
        return {
            "id": existing.id,
            "ticker": existing.ticker,
            "memo_id": existing.memo_id,
            "earnings_date": existing.earnings_date,
            "recap": json.loads(existing.recap_json),
            "created_at": existing.created_at.isoformat() if existing.created_at else None,
            "from_cache": True,
        }

    try:
        recap_dict = await _generate_recap(t, memo, body.earnings_date)
    except (json.JSONDecodeError, ValueError) as exc:
        logger.warning("Recap JSON parse failed for %s: %s", t, exc)
        raise HTTPException(502, "AI returned an invalid response. Please try again.")
    except Exception as exc:
        _ai_error_to_http(exc)

    row = models.AIEarningsRecap(
        ticker=t,
        memo_id=body.memo_id,
        earnings_date=body.earnings_date,
        recap_json=json.dumps(recap_dict),
    )
    try:
        sp = db.begin_nested()
        db.add(row)
        sp.commit()
    except IntegrityError:
        sp.rollback()
        db.rollback()
        existing = (
            db.query(models.AIEarningsRecap)
            .filter_by(memo_id=body.memo_id, earnings_date=body.earnings_date)
            .first()
        )
        if existing:
            return {
                "id": existing.id,
                "ticker": existing.ticker,
                "memo_id": existing.memo_id,
                "earnings_date": existing.earnings_date,
                "recap": json.loads(existing.recap_json),
                "created_at": existing.created_at.isoformat() if existing.created_at else None,
                "from_cache": True,
            }
        raise HTTPException(500, "Failed to save recap")

    notif = models.Notification(
        user_id=current_user.id,
        type="earnings_recap",
        message=f"Earnings recap generated for {t}",
        link=f"/ticker/{t}",
    )
    db.add(notif)
    db.commit()

    return {
        "id": row.id,
        "ticker": row.ticker,
        "memo_id": row.memo_id,
        "earnings_date": row.earnings_date,
        "recap": recap_dict,
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "from_cache": False,
    }


@router.post("/internal/earnings-batch")
async def earnings_batch_trigger(
    request_body: BatchTriggerRequest,
    x_internal_key: Optional[str] = Header(None),
    db: Session = Depends(get_db),
):
    """Called by the Supabase daily edge function to generate batch recaps.

    Secured by X-Internal-Key header — not user-auth'd.
    Each item in the body has the memo context so no extra DB queries are needed
    for memo content (the edge function reads from Supabase directly).
    """
    # Validate internal key
    if not _INTERNAL_KEY or x_internal_key != _INTERNAL_KEY:
        raise HTTPException(401, "Invalid internal key")

    results = []
    for item in request_body.items:
        ticker = str(item.get("ticker", "")).upper()
        memo_id = item.get("memo_id")
        earnings_date = str(item.get("earnings_date", ""))
        user_id = item.get("user_id")
        if not ticker or not memo_id or not earnings_date or not user_id:
            results.append({"ticker": ticker, "status": "skipped", "reason": "missing fields"})
            continue

        # Check if recap already exists
        existing = (
            db.query(models.AIEarningsRecap)
            .filter_by(memo_id=memo_id, earnings_date=earnings_date)
            .first()
        )
        if existing:
            results.append({"ticker": ticker, "status": "already_exists"})
            continue

        # Verify earnings actually occurred near this date. The edge function
        # sends every published memo daily with earnings_date=yesterday; without
        # this gate every memo would get a recap + notification every single day.
        if not await _earnings_reported_near(ticker, earnings_date):
            results.append({"ticker": ticker, "status": "skipped", "reason": "no earnings near date"})
            continue

        # Reconstruct a minimal memo-like object from the edge function payload
        class _FakeMemo:
            thesis_summary = item.get("thesis_summary")
            moat_notes = item.get("moat_notes")
            financial_health_notes = item.get("financial_health_notes")
            risks = item.get("risks")

        try:
            recap_dict = await _generate_recap(ticker, _FakeMemo(), earnings_date)
        except Exception as exc:
            logger.warning("Batch recap failed for %s/%s: %s", ticker, earnings_date, exc)
            results.append({"ticker": ticker, "status": "error", "reason": str(exc)})
            continue

        row = models.AIEarningsRecap(
            ticker=ticker,
            memo_id=memo_id,
            earnings_date=earnings_date,
            recap_json=json.dumps(recap_dict),
        )
        try:
            sp = db.begin_nested()
            db.add(row)
            sp.commit()
        except IntegrityError:
            sp.rollback()
            results.append({"ticker": ticker, "status": "already_exists"})
            continue
        except Exception as exc:
            sp.rollback()
            results.append({"ticker": ticker, "status": "error", "reason": str(exc)})
            continue

        # Insert notification and commit this item atomically
        notif = models.Notification(
            user_id=user_id,
            type="earnings_recap",
            message=f"Earnings recap generated for {ticker}",
            link=f"/ticker/{ticker}",
        )
        db.add(notif)
        try:
            db.commit()
            results.append({"ticker": ticker, "status": "generated", "recap_id": row.id})
        except Exception as exc:
            db.rollback()
            logger.warning("Batch commit failed for %s: %s", ticker, exc)
            results.append({"ticker": ticker, "status": "error", "reason": "commit failed"})

    return {"results": results, "total": len(results)}
