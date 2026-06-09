from datetime import datetime, timezone
from sqlalchemy import Column, Integer, String, Float, DateTime, ForeignKey, UniqueConstraint
from sqlalchemy.orm import relationship
from app.database import Base


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

    portfolios  = relationship("Portfolio",   back_populates="owner", cascade="all, delete")
    watchlist   = relationship("Watchlist",   back_populates="owner", cascade="all, delete")
    alerts      = relationship("PriceAlert",  back_populates="owner", cascade="all, delete")


class Portfolio(Base):
    __tablename__ = "portfolios"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    name = Column(String, default="My Portfolio")
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))

    owner = relationship("User", back_populates="portfolios")
    items     = relationship("PortfolioItem",     back_populates="portfolio", cascade="all, delete")
    snapshots = relationship("PortfolioSnapshot", back_populates="portfolio", cascade="all, delete")


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
    user_id    = Column(Integer, ForeignKey("users.id"), nullable=True)
    rating     = Column(Integer, nullable=False)          # 1-5
    category   = Column(String,  nullable=False)          # Bug / Feature / General
    message    = Column(String,  nullable=False)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
