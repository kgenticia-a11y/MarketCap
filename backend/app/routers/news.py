"""News feed and thesis-impact flagging.

/news/feed          — aggregated recent news across the user's tracked tickers
/news/impact/generate — AI impact assessment of a news headline vs a memo thesis
"""

import asyncio
import json
import logging
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app import models, auth
from app.database import get_db
from app.services import market_data, claude, ai_guard

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/news", tags=["news"])

# Max tickers to fan-out in the feed (memo tickers prioritised)
_FEED_TICKER_LIMIT = 15

_IMPACT_SYSTEM = (
    "You are a financial analyst. Given an investment memo thesis and a recent "
    "news headline, assess whether the news strengthens, weakens, or is neutral "
    "to the investment thesis. Be specific — reference the thesis directly. "
    "Return ONLY a JSON object, no markdown fences.\n"
    + ai_guard.PROMPT_GUARD
)


# ── Pydantic bodies ──────────────────────────────────────────────────────────

class NewsImpactRequest(BaseModel):
    memo_id: int
    url: str
    headline: str
    ticker: str
    published_at: Optional[str] = None  # ISO timestamp string or None


# ── AI quota helper ──────────────────────────────────────────────────────────

def _consume_ai_quota(user_id: int) -> None:
    """Consume one daily AI-quota unit or raise 429. Call only on a genuine
    cache miss, so idempotent cache hits never drain the user's budget."""
    if not ai_guard.daily_quota.check_and_increment(user_id):
        raise HTTPException(
            429,
            "Daily AI usage limit reached. Your quota resets at midnight UTC.",
            headers={"Retry-After": "3600"},
        )


# ── Helper: build enriched news item ────────────────────────────────────────

def _build_news_item(
    raw: dict,
    ticker: str,
    ai_summary: Optional[str],
    impact_row: Optional[models.MemoNewsImpact],
    memo_id: Optional[int],
) -> dict:
    return {
        "ticker": ticker,
        "title": raw["title"],
        "url": raw["url"],
        "publisher": raw.get("publisher"),
        "published_ts": raw.get("published_ts"),
        "ai_summary": ai_summary,
        "has_memo": memo_id is not None,
        "memo_id": memo_id,
        "impact": impact_row.impact if impact_row else None,
        "impact_reason": impact_row.impact_reason if impact_row else None,
        "impact_id": impact_row.id if impact_row else None,
    }


# ── Endpoints ────────────────────────────────────────────────────────────────

@router.get("/feed")
async def get_news_feed(
    filter: str = Query("all", pattern=r"^(all|watchlist|portfolio|memos)$"),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    """Aggregated recent news for the user's tracked tickers.

    Returns up to 5 news items per ticker across up to 15 tickers (memo tickers
    prioritised). Each item is enriched with:
    - AI summary (from ticker_news_summaries cache)
    - Thesis impact flag (from memo_news_impacts if a published memo exists)
    """
    # Collect tickers with priority: published memos > all memos > watchlist > portfolio
    memo_tickers: dict[str, int] = {}   # ticker -> memo_id (published only)
    all_tickers: set[str] = set()

    if filter in ("all", "memos"):
        rows = (
            db.query(models.InvestmentMemo.ticker, models.InvestmentMemo.id)
            .filter_by(user_id=current_user.id, status="published")
            .all()
        )
        for t, mid in rows:
            memo_tickers[t] = mid
            all_tickers.add(t)

    if filter in ("all", "watchlist"):
        rows = db.query(models.Watchlist.ticker).filter_by(user_id=current_user.id).all()
        all_tickers.update(r[0] for r in rows)

    if filter in ("all", "portfolio"):
        port_ids = [
            r[0] for r in
            db.query(models.Portfolio.id).filter_by(user_id=current_user.id).all()
        ]
        if port_ids:
            rows = (
                db.query(models.PortfolioItem.ticker)
                .filter(models.PortfolioItem.portfolio_id.in_(port_ids))
                .distinct()
                .all()
            )
            all_tickers.update(r[0] for r in rows)

    if not all_tickers:
        return {"items": [], "tickers_checked": 0}

    # Prioritise memo tickers; fill remainder from the broader set
    ordered: list[str] = list(memo_tickers.keys())
    for t in all_tickers:
        if t not in memo_tickers:
            ordered.append(t)
    ordered = ordered[:_FEED_TICKER_LIMIT]

    # Fan-out news fetch
    sem = asyncio.Semaphore(5)

    async def fetch_one(t: str) -> list[dict]:
        async with sem:
            try:
                return await market_data.get_ticker_news(t)
            except Exception:
                return []

    results = await asyncio.gather(*[fetch_one(t) for t in ordered])

    # Flatten and collect all URLs
    flat: list[tuple[str, dict]] = []
    for ticker, items in zip(ordered, results):
        for item in (items or []):
            flat.append((ticker, item))

    # Sort by published_ts desc
    flat.sort(key=lambda x: x[1].get("published_ts") or 0, reverse=True)

    # Bulk fetch AI summaries from ticker_news_summaries
    all_urls = [item["url"] for _, item in flat]
    summary_rows = (
        db.query(models.TickerNewsSummary)
        .filter(models.TickerNewsSummary.url.in_(all_urls))
        .all()
    )
    summary_by_url = {row.url: row.ai_summary for row in summary_rows}

    # Bulk fetch existing impact rows for user's memo tickers
    impact_rows: dict[tuple[int, str], models.MemoNewsImpact] = {}
    if memo_tickers:
        memo_ids = list(memo_tickers.values())
        impacts = (
            db.query(models.MemoNewsImpact)
            .filter(
                models.MemoNewsImpact.memo_id.in_(memo_ids),
                models.MemoNewsImpact.url.in_(all_urls),
            )
            .all()
        )
        for row in impacts:
            impact_rows[(row.memo_id, row.url)] = row

    # Build output
    out = []
    for ticker, item in flat:
        url = item["url"]
        memo_id = memo_tickers.get(ticker)
        impact_row = impact_rows.get((memo_id, url)) if memo_id else None
        out.append(_build_news_item(
            raw=item,
            ticker=ticker,
            ai_summary=summary_by_url.get(url),
            impact_row=impact_row,
            memo_id=memo_id,
        ))

    return {"items": out, "tickers_checked": len(ordered)}


@router.post("/impact/generate", status_code=201)
async def generate_news_impact(
    body: NewsImpactRequest,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    """Generate and store an AI thesis-impact flag for one news headline.

    Idempotent — returns the existing row if one already exists for this
    (memo_id, url) pair. The daily AI quota is consumed only on a genuine cache
    miss, so re-opening a headline that's already flagged never spends budget.
    """
    # Auth: memo must belong to calling user and be published
    memo = (
        db.query(models.InvestmentMemo)
        .filter_by(id=body.memo_id, user_id=current_user.id, status="published")
        .first()
    )
    if not memo:
        raise HTTPException(404, "Published memo not found or does not belong to you")

    # Idempotency check
    existing = (
        db.query(models.MemoNewsImpact)
        .filter_by(memo_id=body.memo_id, url=body.url)
        .first()
    )
    if existing:
        return _impact_row_to_dict(existing, from_cache=True)

    # Cache miss — now consume one AI quota unit.
    _consume_ai_quota(current_user.id)

    # Build thesis context from memo fields
    thesis_ctx = "\n".join(filter(None, [
        f"Thesis: {ai_guard.sanitize_text(memo.thesis_summary, 500)}" if memo.thesis_summary else None,
        f"Moat: {ai_guard.sanitize_text(memo.moat_notes, 400)}" if memo.moat_notes else None,
        f"Risks: {ai_guard.sanitize_text(memo.risks, 400)}" if memo.risks else None,
    ])) or "No thesis content recorded."

    headline_safe = ai_guard.sanitize_text(body.headline, max_len=400)
    prompt = (
        f"Ticker: {body.ticker}\n"
        f"News headline: {ai_guard.wrap_untrusted('headline', headline_safe)}\n\n"
        f"Investment thesis:\n{thesis_ctx}\n\n"
        'Return a JSON object with exactly these keys:\n'
        '{"impact": "<strengthens|weakens|neutral>", "reason": "<1 sentence>"}'
    )

    try:
        raw = await claude.ask_claude_text(
            system=_IMPACT_SYSTEM,
            prompt=prompt,
            max_tokens=150,
        )
    except claude.AINotConfigured:
        raise HTTPException(503, "AI features are not configured on this server.")
    except claude.AIRateLimited as exc:
        raise HTTPException(
            429,
            "The AI service is busy right now. Please try again in a moment.",
            headers={"Retry-After": str(exc.retry_after)},
        )
    except claude.AIRequestError:
        raise HTTPException(502, "AI request failed. Please try again.")

    # Parse and validate
    raw = raw.strip()
    if raw.startswith("```"):
        raw = raw.split("```")[1]
        if raw.startswith("json"):
            raw = raw[4:]
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError as exc:
        logger.warning("News impact JSON parse failed for url=%s: %s", body.url, exc)
        raise HTTPException(502, "AI returned an invalid response. Please try again.")

    impact = str(parsed.get("impact", "neutral")).strip().lower()
    if impact not in ("strengthens", "weakens", "neutral"):
        impact = "neutral"
    reason = ai_guard.sanitize_text(str(parsed.get("reason", "")), max_len=500)

    # Parse published_at
    pub_dt: Optional[datetime] = None
    if body.published_at:
        try:
            pub_dt = datetime.fromisoformat(body.published_at.replace("Z", "+00:00"))
        except Exception:
            pass

    row = models.MemoNewsImpact(
        memo_id=body.memo_id,
        url=body.url,
        ticker=body.ticker.upper(),
        headline=ai_guard.sanitize_text(body.headline, max_len=500),
        impact=impact,
        impact_reason=reason,
        published_at=pub_dt,
    )

    try:
        sp = db.begin_nested()
        db.add(row)
        sp.commit()
    except IntegrityError:
        sp.rollback()
        db.rollback()
        existing = (
            db.query(models.MemoNewsImpact)
            .filter_by(memo_id=body.memo_id, url=body.url)
            .first()
        )
        if existing:
            return _impact_row_to_dict(existing, from_cache=True)
        raise HTTPException(500, "Failed to save impact assessment")

    t = body.ticker.upper()
    notif = models.Notification(
        user_id=current_user.id,
        type="news_impact",
        message=f"News impact assessed for {t}: {impact}",
        link=f"/ticker/{t}",
    )
    db.add(notif)
    db.commit()

    return _impact_row_to_dict(row, from_cache=False)


def _impact_row_to_dict(row: models.MemoNewsImpact, from_cache: bool) -> dict:
    return {
        "id": row.id,
        "memo_id": row.memo_id,
        "url": row.url,
        "ticker": row.ticker,
        "headline": row.headline,
        "impact": row.impact,
        "impact_reason": row.impact_reason,
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "from_cache": from_cache,
    }
