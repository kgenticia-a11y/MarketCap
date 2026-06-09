from fastapi import APIRouter, Depends
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session
from pydantic import BaseModel, Field
from typing import Optional
from app import models, auth
from app.database import get_db

router = APIRouter(prefix="/feedback", tags=["feedback"])

_optional_token = OAuth2PasswordBearer(tokenUrl="/auth/login", auto_error=False)


def _optional_user(
    token: Optional[str] = Depends(_optional_token),
    db: Session = Depends(get_db),
) -> Optional[models.User]:
    if not token:
        return None
    try:
        return auth.get_current_user(token=token, db=db)
    except Exception:
        return None


class FeedbackCreate(BaseModel):
    rating:   int   = Field(..., ge=1, le=5)
    category: str   = Field(..., pattern="^(Bug|Feature|General)$")
    message:  str   = Field(..., min_length=5, max_length=1000)


@router.post("", status_code=201)
def submit_feedback(
    body: FeedbackCreate,
    db: Session = Depends(get_db),
    current_user: Optional[models.User] = Depends(_optional_user),
):
    fb = models.Feedback(
        user_id  = current_user.id if current_user else None,
        rating   = body.rating,
        category = body.category,
        message  = body.message,
    )
    db.add(fb)
    db.commit()
    db.refresh(fb)
    return {"id": fb.id, "message": "Thank you for your feedback!"}
