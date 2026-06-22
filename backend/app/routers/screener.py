import json

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app import models, schemas, auth
from app.database import get_db

router = APIRouter(prefix="/screener", tags=["screener"])


def _to_out(row: models.SavedScreen) -> dict:
    return {
        "id": row.id,
        "name": row.name,
        "filters": json.loads(row.filters),
        "created_at": row.created_at,
    }


@router.get("/saved", response_model=list[schemas.SavedScreenOut])
def get_saved_screens(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    rows = (
        db.query(models.SavedScreen)
        .filter(models.SavedScreen.user_id == current_user.id)
        .order_by(models.SavedScreen.created_at.desc())
        .all()
    )
    return [_to_out(r) for r in rows]


@router.post("/saved", response_model=schemas.SavedScreenOut, status_code=201)
def create_saved_screen(
    body: schemas.SavedScreenCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    count = db.query(models.SavedScreen).filter_by(user_id=current_user.id).count()
    if count >= 20:
        raise HTTPException(400, "Maximum of 20 saved screens reached. Delete some before adding new ones.")
    row = models.SavedScreen(
        user_id=current_user.id,
        name=body.name,
        filters=json.dumps(body.filters),
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return _to_out(row)


@router.delete("/saved/{screen_id}", status_code=204)
def delete_saved_screen(
    screen_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    row = db.query(models.SavedScreen).filter_by(id=screen_id, user_id=current_user.id).first()
    if not row:
        raise HTTPException(404, "Saved screen not found")
    db.delete(row)
    db.commit()
