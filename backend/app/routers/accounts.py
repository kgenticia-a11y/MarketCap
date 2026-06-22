from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app import models, schemas, auth
from app.database import get_db

router = APIRouter(prefix="/accounts", tags=["accounts"])


@router.get("", response_model=list[schemas.UserAccountOut])
def list_accounts(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    return (
        db.query(models.UserAccount)
        .filter_by(user_id=current_user.id)
        .order_by(models.UserAccount.created_at)
        .all()
    )


@router.post("", response_model=schemas.UserAccountOut, status_code=201)
def create_account(
    body: schemas.UserAccountCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    acc = models.UserAccount(user_id=current_user.id, name=body.name.strip(), type=body.type)
    db.add(acc)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, f"An account named '{body.name}' already exists.")
    db.refresh(acc)
    return acc


@router.patch("/{account_id}", response_model=schemas.UserAccountOut)
def update_account(
    account_id: int,
    body: schemas.UserAccountUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    acc = (
        db.query(models.UserAccount)
        .filter_by(id=account_id, user_id=current_user.id)
        .first()
    )
    if not acc:
        raise HTTPException(404, "Account not found")
    if body.name is not None:
        acc.name = body.name.strip()
        # Keep the denormalised label on positions in sync with the rename.
        db.query(models.PortfolioItem).filter_by(account_id=acc.id).update(
            {models.PortfolioItem.account_name: acc.name}
        )
    if body.type is not None:
        acc.type = body.type
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "Another account already uses that name.")
    db.refresh(acc)
    return acc


@router.delete("/{account_id}", status_code=204)
def delete_account(
    account_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    acc = (
        db.query(models.UserAccount)
        .filter_by(id=account_id, user_id=current_user.id)
        .first()
    )
    if not acc:
        raise HTTPException(404, "Account not found")
    # Holdings tagged with this account keep `account_name` (denormalised) so
    # the user still sees a sensible label even after the account is deleted;
    # the FK column nulls out via ON DELETE SET NULL.
    db.delete(acc)
    db.commit()
