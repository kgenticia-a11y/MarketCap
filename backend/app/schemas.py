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


# --- Investment Memos ---

MemoRecommendation = Literal["buy", "hold", "pass", "watch"]
MemoStatus = Literal["draft", "published", "archived"]


class MemoCreate(BaseModel):
    ticker: str = Field(..., min_length=1, max_length=10, pattern=r"^[A-Za-z0-9.\-]+$")


class MemoUpdate(BaseModel):
    """PATCH body — every field optional; only provided fields are applied.

    ticker, status, published_at, and price_at_memo are deliberately absent:
    the ticker is locked at creation, and the other three are managed by the
    publish / archive endpoints so the tracking reference point can't drift.
    """
    business_overview:      Optional[str] = Field(None, max_length=20_000)
    moat_notes:             Optional[str] = Field(None, max_length=20_000)
    financial_health_notes: Optional[str] = Field(None, max_length=20_000)
    valuation_notes:        Optional[str] = Field(None, max_length=20_000)
    risks:                  Optional[str] = Field(None, max_length=20_000)
    thesis_summary:         Optional[str] = Field(None, max_length=500)
    recommendation:         Optional[MemoRecommendation] = None
    price_target:           Optional[float] = Field(None, gt=0, le=1e7)
    target_horizon_months:  Optional[int] = Field(None, ge=1, le=240)


class MoatScorecardUpsert(BaseModel):
    pricing_power:    Optional[int] = Field(None, ge=1, le=5)
    switching_costs:  Optional[int] = Field(None, ge=1, le=5)
    network_effects:  Optional[int] = Field(None, ge=1, le=5)
    scale_advantages: Optional[int] = Field(None, ge=1, le=5)
    brand_moat:       Optional[int] = Field(None, ge=1, le=5)
    notes:            Optional[str] = Field(None, max_length=20_000)


class MoatScorecardOut(MoatScorecardUpsert):
    id: int
    memo_id: int

    model_config = {"from_attributes": True}


class CompsAnalysisUpsert(BaseModel):
    peer_tickers: list[str] = Field(..., max_length=10)
    notes: Optional[str] = Field(None, max_length=20_000)

    @field_validator("peer_tickers")
    @classmethod
    def _valid_tickers(cls, v: list[str]) -> list[str]:
        cleaned = []
        for t in v:
            t = t.strip().upper()
            if not re.fullmatch(r"[A-Z0-9.\-]{1,10}", t):
                raise ValueError(f"Invalid ticker symbol: {t!r}")
            if t not in cleaned:
                cleaned.append(t)
        return cleaned


class CompsAnalysisOut(BaseModel):
    id: int
    memo_id: int
    peer_tickers: list[str]
    notes: Optional[str] = None

    model_config = {"from_attributes": True}


class DcfScenarioCreate(BaseModel):
    scenario_name:        str = Field(..., min_length=1, max_length=40)
    revenue_growth_pct:   float = Field(..., ge=-50, le=100)
    operating_margin_pct: float = Field(..., ge=-100, le=100)
    tax_rate_pct:         float = Field(21.0, ge=0, le=60)
    discount_rate_pct:    float = Field(..., gt=0, le=30)
    terminal_growth_pct:  float = Field(..., ge=-5, le=10)
    projection_years:     int = Field(5, ge=1, le=15)
    fair_value_per_share: Optional[float] = Field(None, ge=0, le=1e7)


class DcfScenarioUpdate(BaseModel):
    scenario_name:        Optional[str] = Field(None, min_length=1, max_length=40)
    revenue_growth_pct:   Optional[float] = Field(None, ge=-50, le=100)
    operating_margin_pct: Optional[float] = Field(None, ge=-100, le=100)
    tax_rate_pct:         Optional[float] = Field(None, ge=0, le=60)
    discount_rate_pct:    Optional[float] = Field(None, gt=0, le=30)
    terminal_growth_pct:  Optional[float] = Field(None, ge=-5, le=10)
    projection_years:     Optional[int] = Field(None, ge=1, le=15)
    fair_value_per_share: Optional[float] = Field(None, ge=0, le=1e7)


class DcfScenarioOut(BaseModel):
    id: int
    memo_id: int
    scenario_name: str
    revenue_growth_pct: float
    operating_margin_pct: float
    tax_rate_pct: float
    discount_rate_pct: float
    terminal_growth_pct: float
    projection_years: int
    fair_value_per_share: Optional[float] = None
    created_at: datetime

    model_config = {"from_attributes": True}


class ThesisCheckpointCreate(BaseModel):
    notes: Optional[str] = Field(None, max_length=5_000)


class ThesisCheckpointOut(BaseModel):
    id: int
    memo_id: int
    checked_at: datetime
    price_at_check: float
    pct_change_since_memo: float
    days_since_memo: int
    notes: Optional[str] = None

    model_config = {"from_attributes": True}


class MemoOut(BaseModel):
    id: int
    ticker: str
    status: MemoStatus
    created_at: datetime
    updated_at: datetime
    published_at: Optional[datetime] = None
    business_overview: Optional[str] = None
    moat_notes: Optional[str] = None
    financial_health_notes: Optional[str] = None
    valuation_notes: Optional[str] = None
    risks: Optional[str] = None
    thesis_summary: Optional[str] = None
    recommendation: Optional[MemoRecommendation] = None
    price_at_memo: Optional[float] = None
    price_target: Optional[float] = None
    target_horizon_months: Optional[int] = None

    model_config = {"from_attributes": True}


class MemoDetailOut(MemoOut):
    moat: Optional[MoatScorecardOut] = None
    comps: Optional[CompsAnalysisOut] = None
    scenarios: list[DcfScenarioOut] = []


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
