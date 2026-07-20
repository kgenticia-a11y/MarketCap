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


# --- Paper Trading ---

class PaperPortfolioSetup(BaseModel):
    starting_cash: float = Field(..., gt=0, le=10_000_000)


class PaperTradeCreate(BaseModel):
    ticker:    str   = Field(..., min_length=1, max_length=10, pattern=r"^[A-Za-z0-9.\-]+$")
    side:      Literal["buy", "sell"]
    # Exactly one of `shares` or `dollar_amount` must be provided.
    shares:        Optional[float] = Field(None, gt=0)
    dollar_amount: Optional[float] = Field(None, gt=0)


class PaperTradeOut(BaseModel):
    id: int
    ticker: str
    side: str
    shares: float
    price: float
    total: float
    executed_at: datetime

    model_config = {"from_attributes": True}


# --- Watchlist ---

class WatchlistItemOut(BaseModel):
    id: int
    ticker: str
    added_at: datetime

    model_config = {"from_attributes": True}


# --- Saved Screens ---

class SavedScreenCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=60)
    filters: dict = Field(..., description="Arbitrary screener filter state, stored as JSON")


class SavedScreenOut(BaseModel):
    id: int
    name: str
    filters: dict
    created_at: datetime

    model_config = {"from_attributes": True}
