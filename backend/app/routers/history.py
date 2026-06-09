from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from app import models, auth
from app.database import get_db

router = APIRouter(prefix="/history", tags=["history"])


@router.get("")
def get_history(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    """Return a unified activity feed for the current user, newest first."""
    events = []

    # Portfolio buys
    portfolios = (
        db.query(models.Portfolio)
        .filter(models.Portfolio.user_id == current_user.id)
        .all()
    )
    for port in portfolios:
        for item in port.items:
            events.append({
                "id":     f"port-{item.id}",
                "type":   "portfolio_buy",
                "ticker": item.ticker,
                "detail": f"{item.shares:g} share{'s' if item.shares != 1 else ''} @ ${item.avg_buy_price:,.2f}",
                "amount": round(item.shares * item.avg_buy_price, 2),
                "date":   item.added_at.strftime("%Y-%m-%dT%H:%M:%SZ") if item.added_at else None,
            })

    # Watchlist adds
    for w in db.query(models.Watchlist).filter(models.Watchlist.user_id == current_user.id).all():
        events.append({
            "id":     f"watch-{w.id}",
            "type":   "watchlist_add",
            "ticker": w.ticker,
            "detail": "Added to watchlist",
            "amount": None,
            "date":   w.added_at.strftime("%Y-%m-%dT%H:%M:%SZ") if w.added_at else None,
        })

    events.sort(key=lambda e: e["date"] or "0000-00-00T00:00:00Z", reverse=True)
    return events
