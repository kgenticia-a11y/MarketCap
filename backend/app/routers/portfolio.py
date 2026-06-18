import asyncio
import json
import logging
from datetime import date as date_type
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from app import models, schemas, auth
from app.config import settings
from app.database import get_db
from app.services import market_data

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


@router.get("/analytics")
async def get_analytics(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    portfolio = _get_or_create_portfolio(current_user, db)
    items = portfolio.items
    if not items:
        return {"holdings": [], "snapshots": [], "total_cost": 0, "total_value": 0,
                "total_pnl": 0, "total_pnl_pct": 0}

    item_dicts = [
        {"ticker": i.ticker, "shares": i.shares, "avg_buy_price": i.avg_buy_price}
        for i in items
    ]
    holdings = await market_data.get_portfolio_analytics(item_dicts)

    total_cost  = sum(h["cost"]  for h in holdings)
    total_value = sum(h["value"] for h in holdings)

    for h in holdings:
        h["allocation_pct"] = round(h["value"] / total_value * 100, 2) if total_value > 0 else 0

    # Upsert today's value snapshot — guarded against TOCTOU: two concurrent
    # analytics requests on the same day could both see no existing snapshot
    # and both try to INSERT, hitting the UniqueConstraint. Catch the resulting
    # IntegrityError and fall back to an UPDATE on the row that won the race.
    today = date_type.today().isoformat()
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

    return {
        "holdings": holdings,
        "snapshots": [
            {"date": s.date, "value": s.total_value, "cost": s.total_cost}
            for s in snapshots
        ],
        "total_cost":    round(total_cost,  2),
        "total_value":   round(total_value, 2),
        "total_pnl":     round(total_value - total_cost, 2),
        "total_pnl_pct": round((total_value - total_cost) / total_cost * 100, 2)
                         if total_cost > 0 else 0,
    }


@router.get("", response_model=schemas.PortfolioOut)
def get_portfolio(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    return _get_or_create_portfolio(current_user, db)


@router.post("/items", response_model=schemas.PortfolioItemOut, status_code=201)
def add_item(
    body: schemas.PortfolioItemCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    portfolio = _get_or_create_portfolio(current_user, db)
    existing = (
        db.query(models.PortfolioItem)
        .filter_by(portfolio_id=portfolio.id, ticker=body.ticker.upper())
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
    )
    db.add(item)
    db.commit()
    db.refresh(item)
    return item


@router.delete("/items/{ticker}", status_code=204)
def remove_item(
    ticker: str,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    portfolio = _get_portfolio(current_user, db)
    item = (
        db.query(models.PortfolioItem)
        .filter_by(portfolio_id=portfolio.id, ticker=ticker.upper())
        .first()
    )
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
    if not settings.anthropic_api_key:
        raise HTTPException(503, "AI analysis is not configured on this server.")

    try:
        import anthropic
    except ImportError:
        raise HTTPException(503, "Anthropic SDK not installed.")

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

    prompt = f"""You are a professional portfolio analyst. Analyze the following investment portfolio and provide structured, actionable insights.{risk_ctx}

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

    aclient = anthropic.AsyncAnthropic(api_key=settings.anthropic_api_key)
    try:
        message = await aclient.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=1024,
            messages=[{"role": "user", "content": prompt}],
        )
    except Exception as exc:
        logger.error("Anthropic API call failed: %s", exc)
        raise HTTPException(502, "AI analysis request failed.")

    if not message.content:
        raise HTTPException(502, "AI returned an empty response.")

    text_block = next((b for b in message.content if b.type == "text"), None)
    if not text_block:
        raise HTTPException(502, "AI returned no text content.")

    text = text_block.text.strip()
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
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    portfolio = _get_portfolio(current_user, db)
    item = (
        db.query(models.PortfolioItem)
        .filter_by(portfolio_id=portfolio.id, ticker=ticker.upper())
        .first()
    )
    if not item:
        raise HTTPException(404, "Ticker not in portfolio")
    item.shares = body.shares
    item.avg_buy_price = body.avg_buy_price
    db.commit()
    db.refresh(item)
    return item
