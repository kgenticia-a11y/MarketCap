from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app import models, schemas, auth
from app.database import get_db

router = APIRouter(prefix="/alerts", tags=["alerts"])


@router.get("", response_model=list[schemas.PriceAlertOut])
def get_alerts(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    return (
        db.query(models.PriceAlert)
        .filter(models.PriceAlert.user_id == current_user.id)
        .order_by(models.PriceAlert.created_at.desc())
        .all()
    )


@router.post("", response_model=schemas.PriceAlertOut, status_code=201)
def create_alert(
    body: schemas.PriceAlertCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    count = db.query(models.PriceAlert).filter_by(user_id=current_user.id).count()
    if count >= 50:
        raise HTTPException(400, "Maximum of 50 alerts reached. Delete some before adding new ones.")
    # Use a tolerance-based check instead of float equality to avoid false
    # negatives from floating-point representation differences on FLOAT columns.
    existing = (
        db.query(models.PriceAlert)
        .filter(
            models.PriceAlert.user_id   == current_user.id,
            models.PriceAlert.ticker    == body.ticker.upper(),
            models.PriceAlert.condition == body.condition,
            models.PriceAlert.target_price.between(
                body.target_price - 0.001,
                body.target_price + 0.001,
            ),
        )
        .first()
    )
    if existing:
        return existing
    alert = models.PriceAlert(
        user_id      = current_user.id,
        ticker       = body.ticker.upper(),
        target_price = body.target_price,
        condition    = body.condition,
    )
    db.add(alert)
    db.commit()
    db.refresh(alert)
    return alert


@router.delete("/{alert_id}", status_code=204)
def delete_alert(
    alert_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    alert = db.query(models.PriceAlert).filter_by(id=alert_id, user_id=current_user.id).first()
    if not alert:
        raise HTTPException(404, "Alert not found")
    db.delete(alert)
    db.commit()
