import asyncio
import logging
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, Path
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app import models, auth
from app.database import get_db
from app.services import market_data, claude, ai_guard

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/ticker", tags=["ticker-hub"])

_TICKER_PATH = Path(..., min_length=1, max_length=10, pattern=r"^[A-Za-z0-9.\-]+$")

_NEWS_SUMMARY_SYSTEM = (
    "You are a financial assistant. Write a single sentence (max 25 words) summarising "
    "the key financial implication of the headline for investors. "
    "Be factual and concise. No commentary, no warnings. "
    + ai_guard.PROMPT_GUARD
)


@router.get("/{symbol}/hub")
async def get_ticker_hub(
    symbol: str = _TICKER_PATH,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    """Main ticker hub endpoint — parallel fan-out of market data + user research."""
    ticker = symbol.upper()

    # Fan out all market-data fetches in parallel
    quote_task = asyncio.create_task(market_data.get_quote(ticker))
    details_task = asyncio.create_task(market_data.get_ticker_details(ticker))
    fundamentals_task = asyncio.create_task(market_data.get_fundamentals(ticker))
    quarterly_task = asyncio.create_task(market_data.get_quarterly_metrics(ticker))
    earnings_task = asyncio.create_task(market_data.get_ticker_earnings_date(ticker))

    results = await asyncio.gather(
        quote_task, details_task, fundamentals_task, quarterly_task, earnings_task,
        return_exceptions=True,
    )
    quote        = results[0] if not isinstance(results[0], Exception) else {}
    details      = results[1] if not isinstance(results[1], Exception) else {}
    fundamentals = results[2] if not isinstance(results[2], Exception) else {}
    quarterly    = results[3] if not isinstance(results[3], Exception) else {}
    earnings_cal = results[4] if not isinstance(results[4], Exception) else {}

    # User research: memos for this ticker
    memos = (
        db.query(models.InvestmentMemo)
        .filter_by(user_id=current_user.id, ticker=ticker)
        .order_by(models.InvestmentMemo.updated_at.desc())
        .all()
    )

    # Watchlist entry (with notes)
    watchlist_item = (
        db.query(models.Watchlist)
        .filter_by(user_id=current_user.id, ticker=ticker)
        .first()
    )

    # Portfolio positions across all user portfolios
    portfolio_ids = [
        row[0] for row in
        db.query(models.Portfolio.id).filter_by(user_id=current_user.id).all()
    ]
    portfolio_positions: list[dict] = []
    if portfolio_ids:
        positions = (
            db.query(models.PortfolioItem)
            .filter(
                models.PortfolioItem.portfolio_id.in_(portfolio_ids),
                models.PortfolioItem.ticker == ticker,
            )
            .all()
        )
        portfolio_positions = [
            {
                "id": p.id,
                "portfolio_id": p.portfolio_id,
                "shares": p.shares,
                "avg_buy_price": p.avg_buy_price,
                "added_at": p.added_at.isoformat() if p.added_at else None,
            }
            for p in positions
        ]

    memo_list = [
        {
            "id": m.id,
            "ticker": m.ticker,
            "status": m.status,
            "recommendation": m.recommendation,
            "thesis_summary": m.thesis_summary,
            "updated_at": m.updated_at.isoformat() if m.updated_at else None,
            "published_at": m.published_at.isoformat() if m.published_at else None,
        }
        for m in memos
    ]

    watchlist_dict: Optional[dict] = None
    if watchlist_item:
        watchlist_dict = {
            "id": watchlist_item.id,
            "ticker": watchlist_item.ticker,
            "added_at": watchlist_item.added_at.isoformat() if watchlist_item.added_at else None,
            "notes": watchlist_item.notes,
            "notes_updated_at": (
                watchlist_item.notes_updated_at.isoformat()
                if watchlist_item.notes_updated_at else None
            ),
        }

    # get_ticker_details wraps its payload in {"results": {...}}
    details_inner = details.get("results", {}) if isinstance(details, dict) else {}

    return {
        "ticker": ticker,
        "name": details_inner.get("name") or fundamentals.get("name"),
        "price": quote.get("price"),
        "change_pct": quote.get("change_pct"),
        "market_cap": details_inner.get("market_cap") or quote.get("market_cap") or fundamentals.get("market_cap"),
        "sector": details_inner.get("sector") or fundamentals.get("sector"),
        "industry": details_inner.get("industry") or fundamentals.get("industry"),
        # Key metrics
        "revenue_growth_pct": fundamentals.get("revenue_growth_pct"),
        "gross_margin_pct": fundamentals.get("gross_margin_pct"),
        "operating_margin_pct": fundamentals.get("operating_margin_pct"),
        "net_margin_pct": fundamentals.get("profit_margin_pct"),
        "roe_pct": fundamentals.get("roe_pct"),
        "debt_to_equity": fundamentals.get("debt_to_equity"),
        "week_52_high": details_inner.get("week_52_high"),
        "week_52_low": details_inner.get("week_52_low"),
        # Quarterly sparklines
        "quarterly": quarterly if isinstance(quarterly, dict) else {},
        # Next earnings date (within 30-day window shown in UI)
        "next_earnings": earnings_cal if isinstance(earnings_cal, dict) and earnings_cal.get("earnings_date") else None,
        # User research
        "memos": memo_list,
        "watchlist_item": watchlist_dict,
        "portfolio_positions": portfolio_positions,
    }


@router.get("/{symbol}/news")
async def get_ticker_news(
    symbol: str = _TICKER_PATH,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    """Return top 5 news items with per-URL AI summaries, cached in DB by URL.

    Cache hits are free (no AI quota). Cache misses use the daily AI quota.
    If the user is over quota the news items are still returned, just without
    a summary for uncached items.
    """
    ticker = symbol.upper()

    raw_news = await market_data.get_ticker_news(ticker)
    if not raw_news:
        return []

    # Bulk-fetch cached summaries for all URLs in one query
    urls = [item["url"] for item in raw_news]
    cached_rows = (
        db.query(models.TickerNewsSummary)
        .filter(models.TickerNewsSummary.url.in_(urls))
        .all()
    )
    cache_by_url = {row.url: row for row in cached_rows}

    uncached = [item for item in raw_news if item["url"] not in cache_by_url]

    new_summaries: list[models.TickerNewsSummary] = []
    for item in uncached:
        # One quota unit per AI call — a single request summarising up to 5
        # uncached URLs must cost 5 units, not 1. Once the user is over budget
        # we stop calling; the remaining items are still returned below, just
        # without a summary.
        if not ai_guard.daily_quota.check_and_increment(current_user.id):
            break

        headline = ai_guard.sanitize_text(item["title"], max_len=300)
        try:
            summary_text: Optional[str] = await claude.ask_claude_text(
                system=_NEWS_SUMMARY_SYSTEM,
                prompt=f'Summarise this financial headline in one sentence: "{headline}"',
                max_tokens=80,
            )
            summary_text = ai_guard.sanitize_text(summary_text, max_len=500)
        except Exception as exc:
            logger.warning("News summary AI call failed for %s: %s", item["url"], exc)
            ai_guard.daily_quota.decrement(current_user.id)
            summary_text = None

        # Only cache a row when we actually produced a summary. TickerNewsSummary
        # is a shared, URL-keyed cache: a persisted NULL-summary row is a
        # permanent cache hit for EVERY user and the URL would never be
        # re-summarised. Skipping the insert lets a later request retry it.
        if not summary_text:
            continue

        pub_ts = item.get("published_ts") or 0
        pub_dt: Optional[datetime] = None
        if pub_ts:
            try:
                pub_dt = datetime.fromtimestamp(pub_ts, tz=timezone.utc)
            except Exception:
                pass

        row = models.TickerNewsSummary(
            ticker=ticker,
            url=item["url"],
            headline=item["title"],
            source=item.get("publisher"),
            published_at=pub_dt,
            ai_summary=summary_text,
        )
        new_summaries.append(row)

    for row in new_summaries:
        try:
            sp = db.begin_nested()
            db.add(row)
            sp.commit()
        except IntegrityError:
            sp.rollback()
            # Another concurrent request already cached this URL — fetch it.
            existing = (
                db.query(models.TickerNewsSummary)
                .filter_by(url=row.url)
                .first()
            )
            if existing:
                cache_by_url[row.url] = existing
            continue
        except Exception as exc:
            sp.rollback()
            logger.warning("Failed to cache news summary for %s: %s", row.url, exc)
            continue
        cache_by_url[row.url] = row

    if new_summaries:
        try:
            db.commit()
        except Exception as exc:
            logger.warning("Failed to commit news summaries: %s", exc)
            db.rollback()

    out = []
    for item in raw_news:
        cached = cache_by_url.get(item["url"])
        out.append({
            "title": item["title"],
            "url": item["url"],
            "publisher": item.get("publisher"),
            "published_ts": item.get("published_ts"),
            "ai_summary": cached.ai_summary if cached else None,
            "from_cache": item["url"] in {row.url for row in cached_rows},
        })
    return out


@router.get("/{symbol}/ownership")
async def get_ticker_ownership(
    symbol: str = _TICKER_PATH,
    current_user: models.User = Depends(auth.get_current_user),
):
    """Return institutional holders and recent insider transactions.

    If yfinance has no ownership data for this ticker, returns
    {available: false} — the frontend degrades cleanly.
    """
    ticker = symbol.upper()
    data = await market_data.get_ownership(ticker)
    return data
