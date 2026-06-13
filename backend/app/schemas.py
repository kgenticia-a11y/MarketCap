import re
from datetime import datetime
from typing import Literal, Optional
from pydantic import BaseModel, EmailStr, Field, field_validator


# --- Auth ---

_SPECIAL = re.compile(r'[!@#$%^&*()\-_=+\[\]{};:\'",.<>/?\\|`~]')


class UserRegister(BaseModel):
    email: EmailStr
    password: str = Field(..., min_length=8, max_length=128)
    accepted_terms: bool = Field(..., description="Must be true — user accepted Terms of Service")

    @field_validator("password")
    @classmethod
    def _password_strength(cls, v: str) -> str:
        """Require at least one uppercase letter, one digit, one special character."""
        if not any(c.isupper() for c in v):
            raise ValueError("Password must contain at least one uppercase letter.")
        if not any(c.isdigit() for c in v):
            raise ValueError("Password must contain at least one number.")
        if not _SPECIAL.search(v):
            raise ValueError("Password must contain at least one special character.")
        return v


class UserLogin(BaseModel):
    email: EmailStr
    password: str = Field(..., max_length=128)  # cap matches UserRegister; prevents oversized bcrypt input


class UserOut(BaseModel):
    id: int
    email: str
    name: Optional[str] = None
    created_at: datetime
    terms_accepted_at: Optional[datetime] = None

    model_config = {"from_attributes": True}


class ProfileUpdate(BaseModel):
    # Allow letters, numbers, spaces, hyphens, apostrophes, periods — reject
    # HTML/script-injection characters at the schema boundary.
    name: Optional[str] = Field(None, max_length=100, pattern=r"^[\w\s\-\.',]+$")


class PasswordUpdate(BaseModel):
    current_password: str = Field(..., max_length=128)
    new_password: str = Field(..., min_length=8, max_length=128)


class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"


# --- Portfolio ---

class PortfolioItemCreate(BaseModel):
    ticker: str = Field(..., min_length=1, max_length=10, pattern=r"^[A-Za-z0-9.\-]+$")
    shares: float = Field(..., gt=0)
    avg_buy_price: float = Field(..., gt=0)


class PortfolioItemOut(BaseModel):
    id: int
    ticker: str
    shares: float
    avg_buy_price: float
    added_at: datetime

    model_config = {"from_attributes": True}


class PortfolioOut(BaseModel):
    id: int
    name: str
    items: list[PortfolioItemOut]

    model_config = {"from_attributes": True}


# --- Watchlist ---

class WatchlistItemOut(BaseModel):
    id: int
    ticker: str
    added_at: datetime

    model_config = {"from_attributes": True}


# --- Price Alerts ---

class PriceAlertCreate(BaseModel):
    ticker:       str                      = Field(..., min_length=1, max_length=10, pattern=r"^[A-Za-z0-9.\-]+$")
    target_price: float                    = Field(..., gt=0)
    condition:    Literal["above", "below"]


class PriceAlertOut(BaseModel):
    id:           int
    ticker:       str
    target_price: float
    condition:    str
    created_at:   datetime

    model_config = {"from_attributes": True}
