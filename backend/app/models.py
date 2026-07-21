from datetime import datetime, timezone
from sqlalchemy import JSON, Column, Integer, String, Float, DateTime, ForeignKey, UniqueConstraint
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy.orm import relationship
from app.database import Base


class PortfolioHealthScore(Base):
    __tablename__ = "portfolio_health_scores"

    id                    = Column(Integer, primary_key=True, index=True)
    portfolio_id          = Column(Integer, ForeignKey("portfolios.id"), nullable=False, index=True)
    date                  = Column(String, nullable=False)   # YYYY-MM-DD
    score                 = Column(Integer, nullable=False)  # 0-100
    grade                 = Column(String, nullable=False)   # A/B/C/D/F
    diversification_score = Column(Integer, nullable=False)  # 0-25
    volatility_score      = Column(Integer, nullable=False)  # 0-25
    concentration_score   = Column(Integer, nullable=False)  # 0-25
    beta_score            = Column(Integer, nullable=False)  # 0-25
    created_at            = Column(DateTime, default=lambda: datetime.now(timezone.utc))

    portfolio = relationship("Portfolio")
    __table_args__ = (UniqueConstraint("portfolio_id", "date"),)


class SavedScreen(Base):
    __tablename__ = "saved_screens"

    id         = Column(Integer, primary_key=True, index=True)
    user_id    = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    name       = Column(String, nullable=False)
    filters    = Column(String, nullable=False)   # JSON-encoded filter state
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))

    owner = relationship("User")


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String, unique=True, index=True, nullable=False)   # stored lowercase
    hashed_password = Column(String, nullable=False)
    name = Column(String, nullable=True)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    # ISO timestamp of when the user accepted the Terms of Service.
    # NULL means they registered before terms were enforced (legacy).
    terms_accepted_at = Column(DateTime, nullable=True)
    # Bumped on password change; embedded in JWTs as "tv" so every token
    # issued before the change stops validating immediately.
    token_version = Column(Integer, nullable=False, default=0, server_default="0")

    portfolios   = relationship("Portfolio",    back_populates="owner", cascade="all, delete")
    watchlist    = relationship("Watchlist",    back_populates="owner", cascade="all, delete")
    saved_screens = relationship("SavedScreen", cascade="all, delete")
    memos        = relationship("InvestmentMemo", back_populates="owner", cascade="all, delete")


class Portfolio(Base):
    __tablename__ = "portfolios"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    name = Column(String, default="My Portfolio")
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))

    owner = relationship("User", back_populates="portfolios")
    items        = relationship("PortfolioItem",        back_populates="portfolio", cascade="all, delete")
    snapshots    = relationship("PortfolioSnapshot",    back_populates="portfolio", cascade="all, delete")
    health_scores = relationship("PortfolioHealthScore", cascade="all, delete")


class PortfolioItem(Base):
    __tablename__ = "portfolio_items"

    id = Column(Integer, primary_key=True, index=True)
    portfolio_id = Column(Integer, ForeignKey("portfolios.id"), nullable=False, index=True)
    ticker = Column(String, nullable=False)
    shares = Column(Float, nullable=False)
    avg_buy_price = Column(Float, nullable=False)
    added_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))

    portfolio = relationship("Portfolio", back_populates="items")
    __table_args__ = (UniqueConstraint("portfolio_id", "ticker"),)


class Watchlist(Base):
    __tablename__ = "watchlists"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    ticker = Column(String, nullable=False)
    added_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))

    owner = relationship("User", back_populates="watchlist")
    __table_args__ = (UniqueConstraint("user_id", "ticker"),)


class PortfolioSnapshot(Base):
    __tablename__ = "portfolio_snapshots"

    id           = Column(Integer, primary_key=True, index=True)
    portfolio_id = Column(Integer, ForeignKey("portfolios.id"), nullable=False, index=True)
    date         = Column(String, nullable=False)   # YYYY-MM-DD
    total_value  = Column(Float,  nullable=False)
    total_cost   = Column(Float,  nullable=False)

    portfolio = relationship("Portfolio", back_populates="snapshots")
    __table_args__ = (UniqueConstraint("portfolio_id", "date"),)


class PaperPortfolio(Base):
    """A user's virtual paper-trading portfolio.

    Completely separate from the real Portfolio model — paper trades never
    touch real holdings. One row per user (created on first paper-trading
    setup); cash_balance reflects available virtual cash after all trades.
    """
    __tablename__ = "paper_portfolio"

    id              = Column(Integer, primary_key=True, index=True)
    user_id         = Column(Integer, ForeignKey("users.id"), nullable=False, unique=True, index=True)
    starting_cash   = Column(Float, nullable=False)
    cash_balance    = Column(Float, nullable=False)
    created_at      = Column(DateTime, default=lambda: datetime.now(timezone.utc))

    owner = relationship("User")
    items   = relationship("PaperPortfolioItem", back_populates="portfolio", cascade="all, delete")
    trades  = relationship("PaperTrade",         back_populates="portfolio", cascade="all, delete")


class PaperPortfolioItem(Base):
    __tablename__ = "paper_portfolio_items"

    id           = Column(Integer, primary_key=True, index=True)
    portfolio_id = Column(Integer, ForeignKey("paper_portfolio.id"), nullable=False, index=True)
    ticker       = Column(String, nullable=False)
    shares       = Column(Float, nullable=False)
    avg_buy_price = Column(Float, nullable=False)
    added_at     = Column(DateTime, default=lambda: datetime.now(timezone.utc))

    portfolio = relationship("PaperPortfolio", back_populates="items")
    __table_args__ = (UniqueConstraint("portfolio_id", "ticker"),)


class PaperTrade(Base):
    """Append-only log of every executed paper trade."""
    __tablename__ = "paper_trade_history"

    id           = Column(Integer, primary_key=True, index=True)
    portfolio_id = Column(Integer, ForeignKey("paper_portfolio.id"), nullable=False, index=True)
    ticker       = Column(String,  nullable=False)
    side         = Column(String,  nullable=False)   # "buy" | "sell"
    shares       = Column(Float,   nullable=False)
    price        = Column(Float,   nullable=False)
    total        = Column(Float,   nullable=False)   # signed: positive cash flow into portfolio for sell, negative for buy
    executed_at  = Column(DateTime, default=lambda: datetime.now(timezone.utc), index=True)

    portfolio = relationship("PaperPortfolio", back_populates="trades")


class AIEarningsBrief(Base):
    """Cached Claude-generated pre-earnings brief for a ticker + report date.

    Generic (not user-specific) so it's generated once per ticker/date and
    served to every user who opens that earnings card — the per-user "your
    position" note is computed locally at request time, not cached here.
    """
    __tablename__ = "ai_earnings_briefs"

    id            = Column(Integer, primary_key=True, index=True)
    ticker        = Column(String, nullable=False, index=True)
    earnings_date = Column(String, nullable=False)   # YYYY-MM-DD
    brief_json    = Column(String, nullable=False)   # JSON-encoded Claude response
    created_at    = Column(DateTime, default=lambda: datetime.now(timezone.utc))

    __table_args__ = (UniqueConstraint("ticker", "earnings_date"),)


class InvestmentMemo(Base):
    """A structured investment memo a user writes about one ticker.

    The memo is the anchor of the guided-research workflow: 1:1 children
    (MoatScorecard, CompsAnalysis), N scenario rows (DcfScenario), and the
    thesis-tracking log (ThesisCheckpoint) all hang off it. `price_at_memo`
    and `published_at` are stamped on first publish and never overwritten —
    they are the fixed reference point every later checkpoint measures
    against.
    """
    __tablename__ = "investment_memos"

    id                     = Column(Integer, primary_key=True, index=True)
    user_id                = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    ticker                 = Column(String, nullable=False)
    status                 = Column(String, nullable=False, default="draft")  # draft | published | archived
    created_at             = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at             = Column(DateTime(timezone=True),
                                    default=lambda: datetime.now(timezone.utc),
                                    onupdate=lambda: datetime.now(timezone.utc))
    published_at           = Column(DateTime(timezone=True), nullable=True)
    business_overview      = Column(String, nullable=True)
    moat_notes             = Column(String, nullable=True)
    financial_health_notes = Column(String, nullable=True)
    valuation_notes        = Column(String, nullable=True)
    risks                  = Column(String, nullable=True)
    thesis_summary         = Column(String, nullable=True)
    recommendation         = Column(String, nullable=True)   # buy | hold | pass | watch
    price_at_memo          = Column(Float, nullable=True)
    price_target           = Column(Float, nullable=True)
    target_horizon_months  = Column(Integer, nullable=True)

    owner       = relationship("User", back_populates="memos")
    moat        = relationship("MoatScorecard", back_populates="memo", cascade="all, delete", uselist=False)
    comps       = relationship("CompsAnalysis", back_populates="memo", cascade="all, delete", uselist=False)
    scenarios   = relationship("DcfScenario", back_populates="memo", cascade="all, delete")
    checkpoints = relationship("ThesisCheckpoint", back_populates="memo", cascade="all, delete")


class MoatScorecard(Base):
    """Five 1-5 moat-dimension ratings, one row per memo."""
    __tablename__ = "moat_scorecards"

    id               = Column(Integer, primary_key=True, index=True)
    memo_id          = Column(Integer, ForeignKey("investment_memos.id"), nullable=False, unique=True)
    pricing_power    = Column(Integer, nullable=True)   # 1-5
    switching_costs  = Column(Integer, nullable=True)   # 1-5
    network_effects  = Column(Integer, nullable=True)   # 1-5
    scale_advantages = Column(Integer, nullable=True)   # 1-5
    brand_moat       = Column(Integer, nullable=True)   # 1-5
    notes            = Column(String, nullable=True)

    memo = relationship("InvestmentMemo", back_populates="moat")


class CompsAnalysis(Base):
    """Peer-comparison ticker list for a memo's valuation section."""
    __tablename__ = "comps_analyses"

    id           = Column(Integer, primary_key=True, index=True)
    memo_id      = Column(Integer, ForeignKey("investment_memos.id"), nullable=False, unique=True)
    # text[] on Postgres (matches the Supabase migration); JSON on SQLite dev
    # where ARRAY doesn't exist — both round-trip a Python list[str].
    peer_tickers = Column(ARRAY(String).with_variant(JSON(), "sqlite"), nullable=False, default=list)
    notes        = Column(String, nullable=True)

    memo = relationship("InvestmentMemo", back_populates="comps")


class DcfScenario(Base):
    """One saved DCF assumption set (base / bull / bear / custom) per row."""
    __tablename__ = "dcf_scenarios"

    id                   = Column(Integer, primary_key=True, index=True)
    memo_id              = Column(Integer, ForeignKey("investment_memos.id"), nullable=False, index=True)
    scenario_name        = Column(String, nullable=False)
    revenue_growth_pct   = Column(Float, nullable=False)
    operating_margin_pct = Column(Float, nullable=False)
    tax_rate_pct         = Column(Float, nullable=False, default=21.0)
    discount_rate_pct    = Column(Float, nullable=False)
    terminal_growth_pct  = Column(Float, nullable=False)
    projection_years     = Column(Integer, nullable=False, default=5)
    fair_value_per_share = Column(Float, nullable=True)
    created_at           = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    memo = relationship("InvestmentMemo", back_populates="scenarios")
    __table_args__ = (UniqueConstraint("memo_id", "scenario_name", name="uq_dcf_scenarios_memo_name"),)


class ThesisCheckpoint(Base):
    """Point-in-time price check against a published memo — the learning loop.

    Rows are append-only; pct_change_since_memo and days_since_memo are
    computed server-side at creation (from price_at_memo / published_at) so
    the history stays truthful even if the memo is later edited.
    """
    __tablename__ = "thesis_checkpoints"

    id                    = Column(Integer, primary_key=True, index=True)
    memo_id               = Column(Integer, ForeignKey("investment_memos.id"), nullable=False, index=True)
    checked_at            = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    price_at_check        = Column(Float, nullable=False)
    pct_change_since_memo = Column(Float, nullable=False)
    days_since_memo       = Column(Integer, nullable=False)
    notes                 = Column(String, nullable=True)

    memo = relationship("InvestmentMemo", back_populates="checkpoints")


class Feedback(Base):
    __tablename__ = "feedback"

    id         = Column(Integer, primary_key=True, index=True)
    # ondelete="SET NULL" lets the DB automatically nullify this column when the
    # referenced user is deleted, as a safety net in addition to the manual
    # anonymisation UPDATE in auth.delete_account (which must run first, in the
    # same transaction, to preserve the existing behaviour).
    user_id    = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    rating     = Column(Integer, nullable=False)          # 1-5
    category   = Column(String,  nullable=False)          # Bug / Feature / General
    message    = Column(String,  nullable=False)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
