from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app import models, schemas, auth
from app.database import get_db

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/register", response_model=schemas.Token, status_code=status.HTTP_201_CREATED)
def register(body: schemas.UserRegister, db: Session = Depends(get_db)):
    """Create a new account.

    Requires the caller to confirm they accepted the Terms of Service
    (accepted_terms=true). Returns the same generic error whether the
    email is a duplicate or invalid — never confirm whether an address
    already exists in our system (account-enumeration prevention).
    """
    if not body.accepted_terms:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You must accept the Terms of Service to create an account.",
        )

    # Normalise email to lowercase before any comparison or storage.
    normalised_email = body.email.lower().strip()

    # Use a generic message regardless of the failure reason so that an
    # attacker cannot enumerate which addresses are already registered.
    if db.query(models.User).filter(models.User.email == normalised_email).first():
        # Burn the same bcrypt work as the success path so a duplicate email
        # isn't detectable by response time.
        auth.equalize_timing(body.password)
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Unable to create account. Please check your details.",
        )

    user = models.User(
        email             = normalised_email,
        hashed_password   = auth.hash_password(body.password),
        terms_accepted_at = datetime.now(timezone.utc),
    )
    db.add(user)
    db.flush()  # assign user.id without committing yet

    # Create default portfolio in the same transaction — atomic, no orphan users.
    db.add(models.Portfolio(user_id=user.id, name="My Portfolio"))
    db.commit()
    db.refresh(user)
    return {"access_token": auth.create_access_token(user.id)}


@router.post("/login", response_model=schemas.Token)
def login(body: schemas.UserLogin, db: Session = Depends(get_db)):
    """Authenticate with email + password.

    Always returns 401 — never hint whether the email or the password
    was the problem.
    """
    normalised_email = body.email.lower().strip()
    user = db.query(models.User).filter(models.User.email == normalised_email).first()
    if not user:
        # Burn the same bcrypt work a real verification costs so an
        # unregistered email isn't detectable by response time.
        auth.equalize_timing(body.password)
        raise HTTPException(status_code=401, detail="Invalid email or password")
    if not auth.verify_password(body.password, user.hashed_password):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    return {"access_token": auth.create_access_token(user.id, user.token_version or 0)}


@router.get("/me", response_model=schemas.UserOut)
def me(current_user: models.User = Depends(auth.get_current_user)):
    return current_user


@router.patch("/profile", response_model=schemas.UserOut)
def update_profile(
    body: schemas.ProfileUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    if body.name is not None:
        current_user.name = body.name.strip() or None
    db.commit()
    db.refresh(current_user)
    return current_user


@router.patch("/password", status_code=204)
def change_password(
    body: schemas.PasswordUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    if not auth.verify_password(body.current_password, current_user.hashed_password):
        raise HTTPException(status_code=401, detail="Current password is incorrect")
    current_user.hashed_password = auth.hash_password(body.new_password)
    # Invalidate every previously issued token (including any stolen one) —
    # the client re-authenticates with the new password.
    current_user.token_version = (current_user.token_version or 0) + 1
    db.commit()


@router.delete("/account", status_code=204)
def delete_account(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    """Permanently delete the authenticated user's account and ALL associated data.

    Cascade rules on the User model ensure that portfolios, watchlists,
    snapshots, and portfolio items are removed atomically.
    Feedback rows whose user_id matches are anonymised (user_id set to
    NULL) rather than deleted, so aggregate quality metrics are preserved
    without retaining any personal identifier.

    GDPR Article 17 / CCPA § 1798.105 — right to erasure.
    """
    # Anonymise feedback — preserve the message for product analytics,
    # but sever the link to the now-deleted user.
    db.query(models.Feedback).filter(
        models.Feedback.user_id == current_user.id
    ).update({"user_id": None})

    db.delete(current_user)
    db.commit()


@router.get("/data-export")
def data_export(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    """Return all data held for the authenticated user as a single JSON object.

    GDPR Article 20 / CCPA § 1798.100 — right of access and data portability.
    """
    portfolio = (
        db.query(models.Portfolio)
        .filter(models.Portfolio.user_id == current_user.id)
        .first()
    )
    items = [
        {
            "ticker":        i.ticker,
            "shares":        i.shares,
            "avg_buy_price": i.avg_buy_price,
            "added_at":      i.added_at.isoformat() if i.added_at else None,
        }
        for i in (portfolio.items if portfolio else [])
    ]
    watchlist = [
        {"ticker": w.ticker, "added_at": w.added_at.isoformat() if w.added_at else None}
        for w in db.query(models.Watchlist).filter(
            models.Watchlist.user_id == current_user.id
        ).all()
    ]
    return {
        "account": {
            "email":             current_user.email,
            "name":              current_user.name,
            "created_at":        current_user.created_at.isoformat() if current_user.created_at else None,
            "terms_accepted_at": current_user.terms_accepted_at.isoformat() if current_user.terms_accepted_at else None,
        },
        "portfolio_items": items,
        "watchlist":        watchlist,
    }
