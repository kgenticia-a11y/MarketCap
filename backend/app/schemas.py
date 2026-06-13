from datetime import datetime
from typing import Optional
from pydantic import BaseModel, EmailStr, Field


# --- Auth ---

class UserRegister(BaseModel):
    email: EmailStr
    password: str = Field(..., min_length=8, max_length=128)
    accepted_terms: bool = Field(..., description="Must be true — user accepted Terms of Service")


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
    name: Optional[str] = Field(None, max_length=100)


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
    ticker:       str   = Field(..., min_length=1, max_length=10, pattern=r"^[A-Za-z0-9.\-]+$")
    target_price: float = Field(..., gt=0)
    condition:    str   # "above" | "below"


class PriceAlertOut(BaseModel):
    id:           int
    ticker:       str
    target_price: float
    condition:    str
    created_at:   datetime

    model_config = {"from_attributes": True}
