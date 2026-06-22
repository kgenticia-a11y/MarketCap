import logging
from datetime import date as date_type

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app import models, schemas, auth
from app.database import get_db
from app.services import market_data

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/paper-trading", tags=["paper-trading"])


def _get_portfolio(user: models.User, db: Session) -> models.PaperPortfolio:
    p = db.query(models.PaperPortfolio).filter_by(user_id=user.id).first()
    if not p:
        raise HTTPException(404, "Paper portfolio not initialised. POST /paper-trading/setup first.")
    return p


@router.get("")
def get_state(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    """Return the paper-portfolio header (cash, starting cash, item count).
    Returns 404 if the user has not set up paper trading yet."""
    p = db.query(models.PaperPortfolio).filter_by(user_id=current_user.id).first()
    if not p:
        raise HTTPException(404, "Not initialised")
    return {
        "id": p.id,
        "starting_cash": p.starting_cash,
        "cash_balance": round(p.cash_balance, 2),
        "created_at": p.created_at,
        "item_count": len(p.items),
    }


@router.post("/setup", status_code=201)
def setup(
    body: schemas.PaperPortfolioSetup,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    existing = db.query(models.PaperPortfolio).filter_by(user_id=current_user.id).first()
    if existing:
        raise HTTPException(409, "Paper portfolio already set up. DELETE first to reset.")
    p = models.PaperPortfolio(
        user_id=current_user.id,
        starting_cash=body.starting_cash,
        cash_balance=body.starting_cash,
    )
    db.add(p)
    db.commit()
    db.refresh(p)
    return {
        "id": p.id,
        "starting_cash": p.starting_cash,
        "cash_balance": p.cash_balance,
        "created_at": p.created_at,
        "item_count": 0,
    }


@router.delete("", status_code=204)
def reset(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    """Wipe the user's paper portfolio entirely (holdings + history + cash)."""
    p = db.query(models.PaperPortfolio).filter_by(user_id=current_user.id).first()
    if not p:
        return
    db.delete(p)
    db.commit()


@router.get("/analytics")
async def analytics(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    """Compute holdings analytics (price, value, P&L, allocation) for the
    paper portfolio. Shape mirrors /portfolio/analytics so the frontend can
    reuse the same charts."""
    p = _get_portfolio(current_user, db)
    items = p.items
    if not items:
        return {
            "holdings": [], "total_cost": 0, "total_value": 0,
            "total_pnl": 0, "total_pnl_pct": 0,
            "cash_balance": round(p.cash_balance, 2),
            "starting_cash": p.starting_cash,
            "equity": round(p.cash_balance, 2),
            "total_return_pct": round((p.cash_balance - p.starting_cash) / p.starting_cash * 100, 2)
                                if p.starting_cash else 0,
        }

    item_dicts = [
        {"ticker": i.ticker, "shares": i.shares, "avg_buy_price": i.avg_buy_price}
        for i in items
    ]
    holdings = await market_data.get_portfolio_analytics(item_dicts)
    total_cost  = sum(h["cost"]  for h in holdings)
    total_value = sum(h["value"] for h in holdings)
    for h in holdings:
        h["allocation_pct"] = round(h["value"] / total_value * 100, 2) if total_value > 0 else 0

    equity = total_value + p.cash_balance
    total_return_pct = (
        round((equity - p.starting_cash) / p.starting_cash * 100, 2)
        if p.starting_cash else 0
    )

    return {
        "holdings": holdings,
        "total_cost":    round(total_cost,  2),
        "total_value":   round(total_value, 2),
        "total_pnl":     round(total_value - total_cost, 2),
        "total_pnl_pct": round((total_value - total_cost) / total_cost * 100, 2)
                         if total_cost > 0 else 0,
        "cash_balance":  round(p.cash_balance, 2),
        "starting_cash": p.starting_cash,
        "equity":        round(equity, 2),
        "total_return_pct": total_return_pct,
    }


@router.post("/trades", response_model=schemas.PaperTradeOut, status_code=201)
async def trade(
    body: schemas.PaperTradeCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    """Execute a paper buy or sell at the current live quote."""
    if (body.shares is None) == (body.dollar_amount is None):
        raise HTTPException(400, "Provide exactly one of `shares` or `dollar_amount`.")

    p = _get_portfolio(current_user, db)
    ticker = body.ticker.upper()

    quote = await market_data.get_quote(ticker)
    price = quote.get("price")
    if not price or price <= 0:
        raise HTTPException(400, f"No live price available for {ticker}.")

    if body.shares is not None:
        shares = float(body.shares)
    else:
        # Dollar-based order: convert to fractional shares at the live price.
        shares = round(float(body.dollar_amount) / price, 6)
        if shares <= 0:
            raise HTTPException(400, "Order size too small.")

    total = round(shares * price, 2)
    existing = db.query(models.PaperPortfolioItem).filter_by(
        portfolio_id=p.id, ticker=ticker
    ).first()

    if body.side == "buy":
        if total > p.cash_balance + 1e-6:
            raise HTTPException(400, f"Insufficient virtual cash. Need ${total:.2f}, have ${p.cash_balance:.2f}.")
        p.cash_balance = round(p.cash_balance - total, 2)
        if existing:
            new_shares = existing.shares + shares
            new_cost   = existing.shares * existing.avg_buy_price + total
            existing.shares = new_shares
            existing.avg_buy_price = round(new_cost / new_shares, 4)
        else:
            db.add(models.PaperPortfolioItem(
                portfolio_id=p.id, ticker=ticker,
                shares=shares, avg_buy_price=round(price, 4),
            ))
        signed_total = -total
    else:  # sell
        if not existing or existing.shares < shares - 1e-9:
            have = existing.shares if existing else 0
            raise HTTPException(400, f"Cannot sell {shares} shares of {ticker} — you only hold {have}.")
        p.cash_balance = round(p.cash_balance + total, 2)
        remaining = existing.shares - shares
        if remaining <= 1e-9:
            db.delete(existing)
        else:
            # Avg cost basis is unchanged on a partial sell — only share count drops.
            existing.shares = remaining
        signed_total = total

    trade_row = models.PaperTrade(
        portfolio_id=p.id, ticker=ticker, side=body.side,
        shares=shares, price=round(price, 4), total=signed_total,
    )
    db.add(trade_row)
    db.commit()
    db.refresh(trade_row)
    return trade_row


@router.get("/trades", response_model=list[schemas.PaperTradeOut])
def list_trades(
    limit: int = 200,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    p = _get_portfolio(current_user, db)
    rows = (
        db.query(models.PaperTrade)
        .filter_by(portfolio_id=p.id)
        .order_by(models.PaperTrade.executed_at.desc())
        .limit(min(limit, 1000))
        .all()
    )
    return rows
