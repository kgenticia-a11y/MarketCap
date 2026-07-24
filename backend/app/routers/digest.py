"""Weekly digest preview endpoint.

GET /digest/preview — structured digest data for the current user:
  - portfolio performance (current vs 7 days ago snapshot)
  - upcoming earnings in the next 7 days for tracked tickers
  - recent unread news impacts (last 7 days)
  - unread notification count
"""

import asyncio
import logging
from datetime import date, timedelta, datetime, timezone

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app import models, auth
from app.database import get_db
from app.services import market_data

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/digest", tags=["digest"])


@router.get("/preview")
async def get_digest_preview(
    current_user: models.User = Depends(auth.get_current_user),
    db: Session = Depends(get_db),
):
    # ── 1. Portfolio performance ─────────────────────────────────────────────
    portfolio = db.query(models.Portfolio).filter(
        models.Portfolio.user_id == current_user.id
    ).first()

    portfolio_perf: dict = {}
    if portfolio:
        today_str = date.today().isoformat()
        week_ago_str = (date.today() - timedelta(days=7)).isoformat()

        today_snap = (
            db.query(models.PortfolioSnapshot)
            .filter(
                models.PortfolioSnapshot.portfolio_id == portfolio.id,
                models.PortfolioSnapshot.date <= today_str,
            )
            .order_by(models.PortfolioSnapshot.date.desc())
            .first()
        )
        week_snap = (
            db.query(models.PortfolioSnapshot)
            .filter(
                models.PortfolioSnapshot.portfolio_id == portfolio.id,
                models.PortfolioSnapshot.date <= week_ago_str,
            )
            .order_by(models.PortfolioSnapshot.date.desc())
            .first()
        )

        current_value = today_snap.total_value if today_snap else None
        week_value = week_snap.total_value if week_snap else None
        change = None
        change_pct = None
        if current_value is not None and week_value and week_value > 0:
            change = round(current_value - week_value, 2)
            change_pct = round((current_value - week_value) / week_value * 100, 2)

        portfolio_perf = {
            "current_value": current_value,
            "week_ago_value": week_value,
            "change": change,
            "change_pct": change_pct,
        }

    # ── 2. Upcoming earnings (next 7 days) ───────────────────────────────────
    # Gather tickers from watchlist + portfolio items + published memos
    ticker_set: set[str] = set()

    watchlist_items = db.query(models.Watchlist).filter(
        models.Watchlist.user_id == current_user.id
    ).all()
    for w in watchlist_items:
        ticker_set.add(w.ticker)

    if portfolio:
        for item in portfolio.items:
            ticker_set.add(item.ticker)

    published_memos = db.query(models.InvestmentMemo).filter(
        models.InvestmentMemo.user_id == current_user.id,
        models.InvestmentMemo.status == "published",
    ).all()
    for m in published_memos:
        ticker_set.add(m.ticker)

    upcoming_earnings: list[dict] = []
    if ticker_set:
        tasks = {
            ticker: asyncio.create_task(market_data.get_ticker_earnings_date(ticker))
            for ticker in list(ticker_set)[:20]
        }
        results = await asyncio.gather(*tasks.values(), return_exceptions=True)
        today = date.today()
        cutoff = today + timedelta(days=7)
        for ticker, result in zip(tasks.keys(), results):
            if isinstance(result, Exception) or not result:
                continue
            ed = result.get("earnings_date")
            if not ed:
                continue
            try:
                ed_date = date.fromisoformat(ed[:10])
            except ValueError:
                continue
            if today <= ed_date <= cutoff:
                upcoming_earnings.append({
                    "ticker": ticker,
                    "earnings_date": ed,
                    "eps_estimate": result.get("eps_estimate"),
                    "revenue_estimate_b": result.get("revenue_estimate_b"),
                })
        upcoming_earnings.sort(key=lambda x: x["earnings_date"])

    # ── 3. Recent unread news impacts (last 7 days) ──────────────────────────
    memo_ids = [m.id for m in published_memos]
    recent_impacts: list[dict] = []
    if memo_ids:
        cutoff_dt = (datetime.now(timezone.utc) - timedelta(days=7)).replace(tzinfo=None)
        impacts = (
            db.query(models.MemoNewsImpact)
            .filter(
                models.MemoNewsImpact.memo_id.in_(memo_ids),
                models.MemoNewsImpact.created_at >= cutoff_dt,
            )
            .order_by(models.MemoNewsImpact.created_at.desc())
            .limit(10)
            .all()
        )
        for imp in impacts:
            recent_impacts.append({
                "id": imp.id,
                "memo_id": imp.memo_id,
                "ticker": imp.ticker,
                "headline": imp.headline,
                "impact": imp.impact,
                "impact_reason": imp.impact_reason,
                "url": imp.url,
                "created_at": imp.created_at.isoformat() if imp.created_at else None,
            })

    # ── 4. Unread notification count ─────────────────────────────────────────
    unread_count = db.query(models.Notification).filter(
        models.Notification.user_id == current_user.id,
        models.Notification.read_at.is_(None),
    ).count()

    return {
        "portfolio_performance": portfolio_perf,
        "upcoming_earnings": upcoming_earnings,
        "recent_news_impacts": recent_impacts,
        "unread_notifications": unread_count,
    }
