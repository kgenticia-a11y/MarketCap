from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Path
from sqlalchemy.orm import Session
from app import models, schemas, auth
from app.database import get_db

router = APIRouter(prefix="/watchlist", tags=["watchlist"])

# Reusable path validator — same charset as the stock router's _TICKER_RE.
_TICKER_PATH = Path(..., min_length=1, max_length=10, pattern=r"^[A-Za-z0-9.\-]+$")


@router.get("", response_model=list[schemas.WatchlistItemOut])
def get_watchlist(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    return db.query(models.Watchlist).filter(models.Watchlist.user_id == current_user.id).all()


@router.post("/{ticker}", response_model=schemas.WatchlistItemOut, status_code=201)
def add_to_watchlist(
    ticker: str = _TICKER_PATH,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    existing = db.query(models.Watchlist).filter_by(user_id=current_user.id, ticker=ticker.upper()).first()
    if existing:
        return existing
    count = db.query(models.Watchlist).filter_by(user_id=current_user.id).count()
    if count >= 100:
        raise HTTPException(400, "Maximum of 100 watchlist items reached. Remove some before adding new ones.")
    item = models.Watchlist(user_id=current_user.id, ticker=ticker.upper())
    db.add(item)
    db.commit()
    db.refresh(item)
    return item


@router.delete("/{ticker}", status_code=204)
def remove_from_watchlist(
    ticker: str = _TICKER_PATH,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    item = db.query(models.Watchlist).filter_by(user_id=current_user.id, ticker=ticker.upper()).first()
    if not item:
        raise HTTPException(404, "Ticker not in watchlist")
    db.delete(item)
    db.commit()


@router.patch("/{ticker}/notes", response_model=schemas.WatchlistItemOut)
def update_watchlist_notes(
    body: schemas.WatchlistNotesUpdate,
    ticker: str = _TICKER_PATH,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    """Autosave research notes for a watchlist entry."""
    item = db.query(models.Watchlist).filter_by(user_id=current_user.id, ticker=ticker.upper()).first()
    if not item:
        raise HTTPException(404, "Ticker not in watchlist")
    item.notes = body.notes
    item.notes_updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(item)
    return item
