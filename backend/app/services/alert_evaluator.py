"""
alert_evaluator.py — Background service for server-side price alert evaluation.

Runs every ALERT_CHECK_INTERVAL_SECONDS (default 90s).

For each unique ticker with at least one un-triggered alert, fetches the
current price from the quote cache (30s TTL — no extra yfinance calls beyond
what the frontend is already generating) and evaluates the above/below
condition.

On the first time a condition is met, sets triggered_at on the alert row.
The alert is NOT automatically deleted — the user dismisses it via DELETE
/alerts/{id}. This mirrors how most brokerage alert systems work.

Design choices:
- Groups by ticker before fetching to avoid N fetches for N alerts on same ticker.
- Uses the existing in-process quote cache — no new yfinance pressure.
- Opens its own DB session (not shared with request handlers) and closes it
  when done, so a slow evaluation cycle never blocks user requests.
- A single error in one ticker's processing does not abort the rest of the pass.
- The loop never raises — transient failures are logged and retried next cycle.
"""
import asyncio
import logging
from datetime import datetime, timezone

from app.database import SessionLocal
from app.models import PriceAlert
from app.services import market_data

logger = logging.getLogger(__name__)

ALERT_CHECK_INTERVAL_SECONDS = 90


async def evaluate_alerts_once() -> dict:
    """Single evaluation pass. Returns a summary dict."""
    db = SessionLocal()
    try:
        active = (
            db.query(PriceAlert)
            .filter(PriceAlert.triggered_at.is_(None))
            .all()
        )
        if not active:
            return {"checked": 0, "triggered": 0}

        # Group by ticker so we fetch each price at most once per pass.
        by_ticker: dict[str, list[PriceAlert]] = {}
        for alert in active:
            by_ticker.setdefault(alert.ticker, []).append(alert)

        triggered_count = 0
        now = datetime.now(timezone.utc)

        for ticker, alerts in by_ticker.items():
            try:
                quote = await market_data.get_quote(ticker)
                price: float = quote["price"]
            except Exception as exc:
                logger.debug("Alert eval: skipping %s — %s", ticker, exc)
                continue

            for alert in alerts:
                hit = (
                    (alert.condition == "above" and price >= alert.target_price) or
                    (alert.condition == "below" and price <= alert.target_price)
                )
                if hit:
                    alert.triggered_at = now
                    triggered_count += 1
                    logger.info(
                        "Alert triggered: user_id=%s %s %s $%.2f (current $%.2f)",
                        alert.user_id,
                        ticker,
                        alert.condition,
                        alert.target_price,
                        price,
                    )

        if triggered_count:
            db.commit()

        return {"checked": len(active), "triggered": triggered_count}

    except Exception as exc:
        logger.error("Alert evaluation pass failed: %s", exc)
        db.rollback()
        return {"checked": 0, "triggered": 0, "error": str(exc)}
    finally:
        db.close()


async def alert_evaluation_loop() -> None:
    """Continuous background loop. Never raises — errors are logged and retried."""
    logger.info(
        "Alert evaluator started — checking every %ds.", ALERT_CHECK_INTERVAL_SECONDS
    )
    while True:
        await asyncio.sleep(ALERT_CHECK_INTERVAL_SECONDS)
        try:
            result = await evaluate_alerts_once()
            if result.get("triggered", 0) > 0:
                logger.info(
                    "Alert eval complete: %d checked, %d triggered.",
                    result["checked"],
                    result["triggered"],
                )
        except Exception as exc:
            logger.error("Alert evaluation loop error: %s", exc)
