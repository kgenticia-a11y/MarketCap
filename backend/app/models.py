from datetime import datetime, timezone
from sqlalchemy import Column, Integer, String, Float, DateTime, ForeignKey, UniqueConstraint
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
    alerts       = relationship("PriceAlert",   back_populates="owner", cascade="all, delete")
    saved_screens = relationship("SavedScreen", cascade="all, delete")


class UserAccount(Base):
    """A user-defined brokerage/retirement/crypto account label.

    Used to tag portfolio items so Holdings can be filtered or aggregated
    across multiple real-world accounts (Robinhood, Fidelity, Roth IRA, etc.).
    """
    __tablename__ = "user_accounts"

    id         = Column(Integer, primary_key=True, index=True)
    user_id    = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    name       = Column(String, nullable=False)
    # Free-form but the API restricts to: brokerage | retirement | crypto | other
    type       = Column(String, nullable=False)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))

    owner = relationship("User")
    __table_args__ = (UniqueConstraint("user_id", "name"),)


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
    # Optional account tag for multi-account aggregation. NULL = unassigned
    # (legacy rows, or single-account users). `account_name` is denormalised
    # so old rows survive an account rename/delete with a sensible label.
    account_id   = Column(Integer, ForeignKey("user_accounts.id", ondelete="SET NULL"), nullable=True, index=True)
    account_name = Column(String, nullable=True)
    added_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))

    portfolio = relationship("Portfolio", back_populates="items")
    account   = relationship("UserAccount")
    # Uniqueness now keyed on account too — same ticker can exist in
    # Robinhood and Fidelity as two separate positions.
    __table_args__ = (UniqueConstraint("portfolio_id", "ticker", "account_id"),)


class Watchlist(Base):
    __tablename__ = "watchlists"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    ticker = Column(String, nullable=False)
    added_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))

    owner = relationship("User", back_populates="watchlist")
    __table_args__ = (UniqueConstraint("user_id", "ticker"),)


class PriceAlert(Base):
    __tablename__ = "price_alerts"

    id           = Column(Integer, primary_key=True, index=True)
    user_id      = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    ticker       = Column(String,  nullable=False)
    target_price = Column(Float,   nullable=False)
    condition    = Column(String,  nullable=False)   # "above" | "below"
    created_at   = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    # Set by the server-side alert evaluator the first time the condition is
    # met; null = still armed. The frontend renders this and the evaluator
    # filters on it, but the column was never added to the model, so every
    # evaluation pass crashed with an AttributeError.
    triggered_at = Column(DateTime, nullable=True)

    owner = relationship("User", back_populates="alerts")


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
