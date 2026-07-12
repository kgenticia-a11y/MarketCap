"""
snapshot_scheduler.py — Daily portfolio value snapshot background job.

The /portfolio/analytics endpoint already writes a snapshot when a user
actively views their portfolio. This scheduler fills the gaps: it runs
once per hour and writes today's snapshot for every portfolio that hasn't
been snapshotted yet today — covering users who haven't opened the app.

This ensures the portfolio history chart never has blank days due to
user inactivity.

Design choices:
- Runs hourly; skips portfolios that already have today's snapshot.
- Does NOT overwrite snapshots written by the analytics endpoint — it only
  fills gaps. Both use upsert-style logic with an IntegrityError guard.
- Staggered per-portfolio: a single error in one portfolio does not abort
  the rest of the batch.
- Opens its own short-lived DB session per run, not shared with handlers.
- A single run completing every portfolio in <1s on a small user base.
  On very large deployments, add a LIMIT+offset pagination loop here.
"""
import asyncio
import logging
from datetime import date
from sqlalchemy.exc import IntegrityError

from app.database import SessionLocal
from app.market_time import market_date
from app.models import Portfolio, PortfolioSnapshot
from app.services import market_data

logger = logging.getLogger(__name__)

SNAPSHOT_CHECK_INTERVAL_SECONDS = 3_600  # Run once per hour


async def snapshot_all_portfolios() -> dict:
    """Write today's snapshot for every active portfolio that doesn't have one yet."""
    db = SessionLocal()
    today = market_date().isoformat()
    written = 0
    skipped = 0
    errors = 0

    try:
        portfolios = db.query(Portfolio).all()

        for portfolio in portfolios:
            if not portfolio.items:
                skipped += 1
                continue

            # The analytics endpoint may have already written today's row.
            existing = (
                db.query(PortfolioSnapshot)
                .filter_by(portfolio_id=portfolio.id, date=today)
                .first()
            )
            if existing:
                skipped += 1
                continue

            try:
                item_dicts = [
                    {
                        "ticker":        item.ticker,
                        "shares":        item.shares,
                        "avg_buy_price": item.avg_buy_price,
                    }
                    for item in portfolio.items
                ]
                holdings = await market_data.get_portfolio_analytics(item_dicts)
                total_value = round(sum(h["value"] for h in holdings), 2)
                total_cost  = round(sum(h["cost"]  for h in holdings), 2)

                try:
                    db.add(PortfolioSnapshot(
                        portfolio_id=portfolio.id,
                        date=today,
                        total_value=total_value,
                        total_cost=total_cost,
                    ))
                    db.commit()
                    written += 1
                except IntegrityError:
                    # Analytics endpoint inserted the row while we were fetching prices.
                    db.rollback()
                    skipped += 1

            except Exception as exc:
                logger.warning(
                    "Snapshot failed for portfolio %d: %s", portfolio.id, exc
                )
                db.rollback()
                errors += 1

        return {"written": written, "skipped": skipped, "errors": errors}

    except Exception as exc:
        logger.error("Snapshot scheduler run failed: %s", exc)
        db.rollback()
        return {"written": 0, "skipped": 0, "errors": 1}
    finally:
        db.close()


async def snapshot_scheduler_loop() -> None:
    """Continuous background loop. Never raises — errors are logged and retried."""
    logger.info(
        "Portfolio snapshot scheduler started — running every %ds.",
        SNAPSHOT_CHECK_INTERVAL_SECONDS,
    )
    while True:
        await asyncio.sleep(SNAPSHOT_CHECK_INTERVAL_SECONDS)
        try:
            result = await snapshot_all_portfolios()
            logger.info(
                "Portfolio snapshots: %d written, %d already existed, %d errors.",
                result["written"],
                result["skipped"],
                result["errors"],
            )
        except Exception as exc:
            logger.error("Snapshot scheduler loop error: %s", exc)
