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

    portfolios   = relationship("Portfolio",    back_populates="owner", cascade="all, delete")
    watchlist    = relationship("Watchlist",    back_populates="owner", cascade="all, delete")
    alerts       = relationship("PriceAlert",   back_populates="owner", cascade="all, delete")
    saved_screens = relationship("SavedScreen", cascade="all, delete")


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


class PriceAlert(Base):
    __tablename__ = "price_alerts"

    id           = Column(Integer, primary_key=True, index=True)
    user_id      = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    ticker       = Column(String,  nullable=False)
    target_price = Column(Float,   nullable=False)
    condition    = Column(String,  nullable=False)   # "above" | "below"
    created_at   = Column(DateTime, default=lambda: datetime.now(timezone.utc))

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
