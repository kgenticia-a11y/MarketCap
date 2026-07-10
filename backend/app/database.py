import logging

from sqlalchemy import create_engine, event
from sqlalchemy.orm import DeclarativeBase, sessionmaker
from app.config import settings

logger = logging.getLogger(__name__)

# SQLite needs check_same_thread=False; ignored by other drivers
_is_sqlite = settings.database_url.startswith("sqlite")
connect_args = {"check_same_thread": False} if _is_sqlite else {}

# Engine config:
#   - pool_pre_ping=True  — recycle dead connections (cloud DBs close idle conns
#     after a few minutes; without this the first query after idle errors out)
#   - pool_size / max_overflow tuned for a typical small-to-mid app
#   - pool_recycle=1800 — proactively recycle every 30 min, well under the
#     usual 1-hour idle timeout on managed Postgres
#   - SQLite uses a single-thread pool, so don't pass pool args.
engine_kwargs = {"connect_args": connect_args}
if not _is_sqlite:
    engine_kwargs.update({
        "pool_size":     settings.db_pool_size,
        "max_overflow":  settings.db_max_overflow,
        "pool_pre_ping": True,
        "pool_recycle":  1800,
    })

engine = create_engine(settings.database_url, **engine_kwargs)

if _is_sqlite:
    @event.listens_for(engine, "connect")
    def _set_sqlite_pragma(dbapi_conn, connection_record):
        cursor = dbapi_conn.cursor()
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.execute("PRAGMA busy_timeout=5000")
        cursor.close()

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Base(DeclarativeBase):
    pass


def run_lightweight_migrations() -> None:
    """Apply additive column migrations that `create_all` won't perform on
    existing tables. Idempotent — safe to run on every boot.

    SQLAlchemy's `create_all` only CREATEs missing tables; it never ALTERs
    existing ones. For dev (SQLite) and small prod (Postgres) we apply a
    handful of `ADD COLUMN` statements here so new columns reach existing
    deployments without a full migration framework.
    """
    from sqlalchemy import inspect, text
    inspector = inspect(engine)

    # Multi-account aggregation: account_id + account_name on portfolio_items.
    if inspector.has_table("portfolio_items"):
        cols = {c["name"] for c in inspector.get_columns("portfolio_items")}
        statements = []
        if "account_id" not in cols:
            statements.append("ALTER TABLE portfolio_items ADD COLUMN account_id INTEGER")
        if "account_name" not in cols:
            statements.append("ALTER TABLE portfolio_items ADD COLUMN account_name VARCHAR")
        if statements:
            with engine.begin() as conn:
                for stmt in statements:
                    logger.info("[migration] %s", stmt)
                    conn.execute(text(stmt))

    # Server-side alert evaluation: triggered_at on price_alerts. The
    # evaluator and the frontend both used this column, but it was never
    # added to the model — every evaluation pass crashed until now.
    if inspector.has_table("price_alerts"):
        cols = {c["name"] for c in inspector.get_columns("price_alerts")}
        if "triggered_at" not in cols:
            stmt = "ALTER TABLE price_alerts ADD COLUMN triggered_at TIMESTAMP"
            with engine.begin() as conn:
                logger.info("[migration] %s", stmt)
                conn.execute(text(stmt))


def get_db():
    """Yield a DB session and ensure rollback on any unhandled exception."""
    db = SessionLocal()
    try:
        yield db
    except Exception:
        # Roll back any partial transaction so the next request starts clean.
        try:
            db.rollback()
        except Exception as exc:
            logger.warning("Rollback failed: %s", exc)
        raise
    finally:
        db.close()
