import asyncio
import json
import logging
from datetime import date as date_type, timedelta
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from app import models, schemas, auth
from app.config import settings
from app.database import get_db
from app.market_time import market_date
from app.services import market_data, health_score, claude

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/portfolio", tags=["portfolio"])


def _get_or_create_portfolio(user: models.User, db: Session) -> models.Portfolio:
    portfolio = db.query(models.Portfolio).filter(models.Portfolio.user_id == user.id).first()
    if not portfolio:
        portfolio = models.Portfolio(user_id=user.id)
        db.add(portfolio)
        db.commit()
        db.refresh(portfolio)
    return portfolio


def _get_portfolio(user: models.User, db: Session) -> models.Portfolio:
    portfolio = db.query(models.Portfolio).filter(models.Portfolio.user_id == user.id).first()
    if not portfolio:
        raise HTTPException(404, "Portfolio not found")
    return portfolio


def _filter_items_by_account(items, account_id: int | None):
    """Filter PortfolioItem rows by account_id. None means 'all accounts'."""
    if account_id is None:
        return list(items)
    return [i for i in items if i.account_id == account_id]


@router.get("/analytics")
async def get_analytics(
    account_id: int | None = Query(None, description="Filter to a single account; omit for aggregate."),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    portfolio = _get_or_create_portfolio(current_user, db)
    items = _filter_items_by_account(portfolio.items, account_id)
    if not items:
        return {"holdings": [], "snapshots": [], "total_cost": 0, "total_value": 0,
                "total_pnl": 0, "total_pnl_pct": 0}

    item_dicts = [
        {"ticker": i.ticker, "shares": i.shares, "avg_buy_price": i.avg_buy_price}
        for i in items
    ]
    holdings = await market_data.get_portfolio_analytics(item_dicts)
    # Re-attach account info — get_portfolio_analytics preserves order, so we
    # can zip back. (Items whose fetch failed are dropped, but we filter them
    # back out below to keep the mapping aligned.)
    for h, src in zip(holdings, items):
        h["account_id"]   = src.account_id
        h["account_name"] = src.account_name

    total_cost  = sum(h["cost"]  for h in holdings)
    total_value = sum(h["value"] for h in holdings)

    for h in holdings:
        h["allocation_pct"] = round(h["value"] / total_value * 100, 2) if total_value > 0 else 0

    # Upsert today's value snapshot — guarded against TOCTOU: two concurrent
    # analytics requests on the same day could both see no existing snapshot
    # and both try to INSERT, hitting the UniqueConstraint. Catch the resulting
    # IntegrityError and fall back to an UPDATE on the row that won the race.
    today = market_date().isoformat()
    snap = db.query(models.PortfolioSnapshot).filter_by(
        portfolio_id=portfolio.id, date=today
    ).first()
    if snap:
        snap.total_value = round(total_value, 2)
        snap.total_cost  = round(total_cost,  2)
        db.commit()
    else:
        try:
            db.add(models.PortfolioSnapshot(
                portfolio_id=portfolio.id,
                date=today,
                total_value=round(total_value, 2),
                total_cost=round(total_cost,  2),
            ))
            db.commit()
        except IntegrityError:
            # Another concurrent request inserted the row first — roll back
            # the failed INSERT and update the winner's row instead.
            db.rollback()
            snap = db.query(models.PortfolioSnapshot).filter_by(
                portfolio_id=portfolio.id, date=today
            ).first()
            if snap:
                snap.total_value = round(total_value, 2)
                snap.total_cost  = round(total_cost,  2)
                db.commit()

    snapshots = (
        db.query(models.PortfolioSnapshot)
        .filter_by(portfolio_id=portfolio.id)
        .order_by(models.PortfolioSnapshot.date)
        .all()
    )

    snapshot_list = [
        {"date": s.date, "value": s.total_value, "cost": s.total_cost}
        for s in snapshots
    ]

    # Fetch SPY benchmark data for the same date range as snapshots
    benchmark = []
    if len(snapshot_list) >= 2:
        start_date = snapshot_list[0]["date"]
        # yfinance treats `end` as EXCLUSIVE, so passing today dropped the
        # most recent SPY close and left the benchmark line one day behind
        # the portfolio line at its most-viewed point.
        end_date = (market_date() + timedelta(days=1)).isoformat()
        try:
            benchmark = await market_data.get_benchmark_history(start_date, end_date)
        except Exception:
            logger.warning("Failed to fetch SPY benchmark data")

    # Dividend income totals
    total_annual_dividend_income = round(
        sum(h.get("annual_dividend_income", 0) for h in holdings), 2
    )
    total_monthly_dividend_income = round(total_annual_dividend_income / 12, 2)

    return {
        "holdings": holdings,
        "snapshots": snapshot_list,
        "benchmark": benchmark,
        "total_cost":    round(total_cost,  2),
        "total_value":   round(total_value, 2),
        "total_pnl":     round(total_value - total_cost, 2),
        "total_pnl_pct": round((total_value - total_cost) / total_cost * 100, 2)
                         if total_cost > 0 else 0,
        "total_annual_dividend_income":  total_annual_dividend_income,
        "total_monthly_dividend_income": total_monthly_dividend_income,
    }


@router.get("/health-score")
async def get_health_score(
    account_id: int | None = Query(None),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    portfolio = _get_or_create_portfolio(current_user, db)
    items = _filter_items_by_account(portfolio.items, account_id)
    if not items:
        result = health_score.compute_health_score([], 0)
        return {**result, "history": []}

    item_dicts = [
        {"ticker": i.ticker, "shares": i.shares, "avg_buy_price": i.avg_buy_price}
        for i in items
    ]
    holdings = await market_data.get_portfolio_analytics(item_dicts)
    total_value = sum(h["value"] for h in holdings)
    for h in holdings:
        h["allocation_pct"] = round(h["value"] / total_value * 100, 2) if total_value > 0 else 0

    result = health_score.compute_health_score(holdings, total_value)

    # Upsert today's row — same TOCTOU-safe pattern as the snapshot upsert above.
    today = market_date().isoformat()
    row = db.query(models.PortfolioHealthScore).filter_by(
        portfolio_id=portfolio.id, date=today
    ).first()
    sub = result["sub_scores"]
    if row:
        row.score = result["score"]
        row.grade = result["grade"]
        row.diversification_score = sub["diversification"]["score"]
        row.volatility_score = sub["volatility"]["score"]
        row.concentration_score = sub["concentration"]["score"]
        row.beta_score = sub["beta"]["score"]
        db.commit()
    else:
        try:
            db.add(models.PortfolioHealthScore(
                portfolio_id=portfolio.id, date=today,
                score=result["score"], grade=result["grade"],
                diversification_score=sub["diversification"]["score"],
                volatility_score=sub["volatility"]["score"],
                concentration_score=sub["concentration"]["score"],
                beta_score=sub["beta"]["score"],
            ))
            db.commit()
        except IntegrityError:
            db.rollback()  # another concurrent request won the insert race; today's row already exists

    cutoff = (date_type.today() - timedelta(days=30)).isoformat()
    history_rows = (
        db.query(models.PortfolioHealthScore)
        .filter(models.PortfolioHealthScore.portfolio_id == portfolio.id,
                models.PortfolioHealthScore.date >= cutoff)
        .order_by(models.PortfolioHealthScore.date)
        .all()
    )
    history = [{"date": r.date, "score": r.score} for r in history_rows]
    # Make sure today's freshly computed score is reflected even if the row
    # above lost a commit race — append/replace rather than trusting the read.
    if history and history[-1]["date"] == today:
        history[-1]["score"] = result["score"]
    else:
        history.append({"date": today, "score": result["score"]})

    return {**result, "history": history}


@router.get("", response_model=schemas.PortfolioOut)
def get_portfolio(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    return _get_or_create_portfolio(current_user, db)


def _resolve_account(current_user: models.User, account_id: int | None, db: Session):
    """Validate the account belongs to the current user, return (id, name)."""
    if account_id is None:
        return None, None
    acc = (
        db.query(models.UserAccount)
        .filter_by(id=account_id, user_id=current_user.id)
        .first()
    )
    if not acc:
        raise HTTPException(404, "Account not found")
    return acc.id, acc.name


@router.post("/items", response_model=schemas.PortfolioItemOut, status_code=201)
def add_item(
    body: schemas.PortfolioItemCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    portfolio = _get_or_create_portfolio(current_user, db)
    acc_id, acc_name = _resolve_account(current_user, body.account_id, db)
    existing = (
        db.query(models.PortfolioItem)
        .filter_by(portfolio_id=portfolio.id, ticker=body.ticker.upper(), account_id=acc_id)
        .first()
    )
    if existing:
        # Update shares and recalculate weighted-average buy price.
        total_cost = existing.shares * existing.avg_buy_price + body.shares * body.avg_buy_price
        new_shares = existing.shares + body.shares
        if new_shares <= 0:
            raise HTTPException(400, "Resulting share count must be positive.")
        existing.shares = new_shares
        existing.avg_buy_price = round(total_cost / new_shares, 4)
        db.commit()
        db.refresh(existing)
        return existing
    item = models.PortfolioItem(
        portfolio_id=portfolio.id,
        ticker=body.ticker.upper(),
        shares=body.shares,
        avg_buy_price=body.avg_buy_price,
        account_id=acc_id,
        account_name=acc_name,
    )
    db.add(item)
    db.commit()
    db.refresh(item)
    return item


@router.delete("/items/{ticker}", status_code=204)
def remove_item(
    ticker: str,
    account_id: int | None = Query(None),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    portfolio = _get_portfolio(current_user, db)
    q = db.query(models.PortfolioItem).filter_by(
        portfolio_id=portfolio.id, ticker=ticker.upper()
    )
    if account_id is not None:
        q = q.filter(models.PortfolioItem.account_id == account_id)
    elif q.count() > 1:
        # Same ticker held in multiple accounts: picking .first() silently
        # deleted an arbitrary one. Force the caller to disambiguate.
        raise HTTPException(409, "Ticker exists in multiple accounts — pass account_id.")
    item = q.first()
    if not item:
        raise HTTPException(404, "Ticker not in portfolio")
    db.delete(item)
    db.commit()


class AnalyzeRequest(BaseModel):
    holdings: list[dict[str, Any]] = Field(max_length=100)
    risk_profile: dict[str, str] | None = None
    total_value: float = 0
    total_pnl_pct: float = 0


@router.post("/analyze")
async def analyze_portfolio(
    body: AnalyzeRequest,
    current_user: models.User = Depends(auth.get_current_user),
):
    risk_ctx = ""
    if body.risk_profile:
        rp = body.risk_profile
        risk_ctx = (
            f"\nInvestor profile: horizon={rp.get('horizon','unknown')}, "
            f"risk_tolerance={rp.get('tolerance','unknown')}, "
            f"goal={rp.get('goal','unknown')}."
        )

    holdings_lines = "\n".join(
        f"- {h.get('ticker','?')} ({h.get('name','?')}): "
        f"{h.get('shares',0)} shares @ ${h.get('avg_buy_price',0):.2f} avg cost, "
        f"current ${h.get('current_price',0):.2f}, "
        f"sector={h.get('sector','Unknown')}, "
        f"weight={h.get('allocation_pct',0):.1f}%, "
        f"P&L {'+' if h.get('pnl',0)>=0 else ''}{h.get('pnl',0):.2f} ({'+' if h.get('pnl_pct',0)>=0 else ''}{h.get('pnl_pct',0):.1f}%)"
        for h in body.holdings
    )

    prompt = f"""Analyze the following investment portfolio and provide structured, actionable insights.{risk_ctx}

Portfolio total value: ${body.total_value:,.2f}
Overall return: {'+' if body.total_pnl_pct >= 0 else ''}{body.total_pnl_pct:.2f}%

Holdings:
{holdings_lines}

Respond in the following JSON structure (no markdown, pure JSON):
{{
  "summary": "2-3 sentence overall portfolio health assessment",
  "strengths": ["strength 1", "strength 2", "strength 3"],
  "risks": ["risk 1", "risk 2", "risk 3"],
  "recommendations": [
    {{"title": "Recommendation title", "detail": "Specific actionable detail"}},
    {{"title": "Recommendation title", "detail": "Specific actionable detail"}},
    {{"title": "Recommendation title", "detail": "Specific actionable detail"}}
  ],
  "beginner_explanation": "Plain-language paragraph suitable for a first-time investor explaining the portfolio's current state and what they should know"
}}"""

    try:
        text = await claude.ask_claude_text(
            system="You are a professional portfolio analyst. Always respond with pure JSON, no markdown fences.",
            prompt=prompt,
            max_tokens=1536,
        )
    except claude.ClaudeNotConfigured:
        raise HTTPException(503, "AI analysis is not configured on this server.")
    except claude.ClaudeRequestError:
        raise HTTPException(502, "AI analysis request failed.")

    if text.startswith("```"):
        text = text.split("\n", 1)[1].rsplit("```", 1)[0].strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        return {"raw": text}


@router.patch("/items/{ticker}")
def update_item(
    ticker: str,
    body: schemas.PortfolioItemCreate,
    account_id: int | None = Query(None),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    portfolio = _get_portfolio(current_user, db)
    q = db.query(models.PortfolioItem).filter_by(
        portfolio_id=portfolio.id, ticker=ticker.upper()
    )
    if account_id is not None:
        q = q.filter(models.PortfolioItem.account_id == account_id)
    elif q.count() > 1:
        # Same guard as remove_item: never silently update an arbitrary one
        # of several same-ticker positions across accounts.
        raise HTTPException(409, "Ticker exists in multiple accounts — pass account_id.")
    item = q.first()
    if not item:
        raise HTTPException(404, "Ticker not in portfolio")
    item.shares = body.shares
    item.avg_buy_price = body.avg_buy_price
    db.commit()
    db.refresh(item)
    return item
