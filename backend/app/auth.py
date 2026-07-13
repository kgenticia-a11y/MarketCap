from datetime import datetime, timedelta, timezone
from typing import Optional
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
import bcrypt
from sqlalchemy.orm import Session
from app.config import settings
from app.database import get_db
from app import models

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/login")


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def verify_password(plain: str, hashed: str) -> bool:
    return bcrypt.checkpw(plain.encode(), hashed.encode())


# Verifying against this constant hash when no user row exists keeps the
# login/register code path duration independent of whether the email is
# registered — bcrypt otherwise only ran for real accounts, which let an
# attacker enumerate registered emails by response time.
_TIMING_EQUALIZER_HASH = bcrypt.hashpw(b"timing-equalizer-not-a-real-password", bcrypt.gensalt()).decode()


def equalize_timing(password: str) -> None:
    """Burn the same bcrypt work a real verification would cost."""
    bcrypt.checkpw(password.encode(), _TIMING_EQUALIZER_HASH.encode())


def create_access_token(user_id: int, token_version: int = 0) -> str:
    expire = datetime.now(timezone.utc) + timedelta(minutes=settings.jwt_expire_minutes)
    # "tv" (token version) is bumped on password change, which invalidates
    # every previously issued token for the account.
    return jwt.encode(
        {"sub": str(user_id), "exp": expire, "tv": token_version},
        settings.jwt_secret, algorithm=settings.jwt_algorithm,
    )


def get_current_user(token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)) -> models.User:
    credentials_error = HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")
    try:
        payload = jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
        user_id: Optional[str] = payload.get("sub")
        if user_id is None:
            raise credentials_error
    except JWTError:
        raise credentials_error
    # Guard against float strings ("1.5"), negative values, and ints that
    # exceed Postgres integer range — all raise ValueError or produce a DB error
    # rather than the expected 401 if left unhandled.
    try:
        uid = int(user_id)
        if uid <= 0 or uid > 2_147_483_647:  # Postgres INTEGER max
            raise ValueError
    except (ValueError, TypeError):
        raise credentials_error
    user = db.query(models.User).filter(models.User.id == uid).first()
    if user is None:
        raise credentials_error
    # Tokens issued before the account's current token_version (bumped on
    # password change) are dead — a stolen token can't outlive a reset.
    if payload.get("tv", 0) != (user.token_version or 0):
        raise credentials_error
    return user
