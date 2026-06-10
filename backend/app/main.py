import asyncio
import logging
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import text

from app.config import settings
from app.database import Base, SessionLocal, engine
from app.middleware import AuthRateLimiter, BodySizeLimiter, RequestIDMiddleware, SecurityHeadersMiddleware
from app.routers import auth, stocks, news, portfolio, watchlist, history, feedback, alerts, admin
from app.services import market_data
from app.services.auto_fixer import run_auto_fixer

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    Base.metadata.create_all(bind=engine)

    def _on_task_done(t: asyncio.Task) -> None:
        if not t.cancelled() and (exc := t.exception()):
            logger.error("Background task '%s' raised an unhandled exception: %s", t.get_name(), exc)

    warm_task = asyncio.create_task(_warm_screener(), name="screener-warmup")
    warm_task.add_done_callback(_on_task_done)

    overview_task = asyncio.create_task(stocks.warm_overview(), name="overview-warmup")
    overview_task.add_done_callback(_on_task_done)

    # Autonomous loop that keeps the real-time market-overview cache warm so
    # stock data always loads instantly, regardless of traffic. Cancelled on
    # shutdown below.
    overview_refresh_task = asyncio.create_task(
        stocks.refresh_overview_loop(), name="overview-refresh-loop"
    )
    overview_refresh_task.add_done_callback(_on_task_done)

    if settings.auto_fixer_enabled:
        logger.info("Auto-fixer ENABLED — running every %d hours.", settings.auto_fixer_interval_hours)
        fix_task = asyncio.create_task(_auto_fix_loop(), name="auto-fix-loop")
        fix_task.add_done_callback(_on_task_done)
    else:
        logger.info("Auto-fixer disabled (set AUTO_FIXER_ENABLED=true to enable).")
    logger.info("MarketCap API started")
    yield

    # ── Shutdown ──────────────────────────────────────────────────────────
    overview_refresh_task.cancel()
    try:
        await overview_refresh_task
    except asyncio.CancelledError:
        pass
    logger.info("MarketCap API shutting down")


async def _warm_screener():
    try:
        logger.info("Warming screener cache…")
        await market_data.get_screener()
        logger.info("Screener cache ready.")
    except Exception as exc:
        logger.warning("Screener warm-up failed: %s", exc)


async def _auto_fix_loop():
    """Run the auto-fixer on the configured interval."""
    interval = timedelta(hours=settings.auto_fixer_interval_hours)
    while True:
        next_run = datetime.now(timezone.utc) + interval
        admin.set_next_run_at(next_run.isoformat())
        logger.info(
            "[auto_fixer] Next run scheduled at %s (in %d hours).",
            next_run.strftime("%Y-%m-%d %H:%M UTC"),
            settings.auto_fixer_interval_hours,
        )
        await asyncio.sleep(interval.total_seconds())
        logger.info("[auto_fixer] Starting scheduled run…")
        try:
            summary = await run_auto_fixer()
            admin._last_run = summary
            logger.info(
                "[auto_fixer] Scheduled run complete — %d applied, %d skipped.",
                summary.get("applied", 0),
                summary.get("skipped", 0),
            )
        except Exception as exc:
            logger.error("[auto_fixer] Scheduled run failed: %s", exc)


app = FastAPI(title="MarketCap API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "X-Request-ID", "X-Admin-Token"],
)

app.add_middleware(SecurityHeadersMiddleware)

# Per-IP rate limit on auth endpoints (default: 10 attempts / minute).
app.add_middleware(AuthRateLimiter)

# Reject oversized request bodies before they reach the handler.
app.add_middleware(BodySizeLimiter, max_bytes=settings.max_body_bytes)

# Stamp every request with an X-Request-ID for traceability.
app.add_middleware(RequestIDMiddleware)


# Global exception handler — never leak stack traces to clients.
@app.exception_handler(Exception)
async def _unhandled_exception_handler(request: Request, exc: Exception):
    logger.exception("Unhandled exception on %s %s", request.method, request.url.path)
    return JSONResponse(
        status_code=500,
        content={"detail": "Internal server error."},
    )

app.include_router(auth.router)
app.include_router(stocks.router)
app.include_router(news.router)
app.include_router(portfolio.router)
app.include_router(watchlist.router)
app.include_router(history.router)
app.include_router(feedback.router)
app.include_router(alerts.router)
app.include_router(admin.router)




@app.get("/health")
def health():
    """Liveness + readiness probe. Verifies the DB connection is alive.

    Container orchestrators (k8s, Fly, Render, etc.) should hit this on a
    short interval. A failed DB check returns 503 so the platform won't
    route traffic to a half-broken instance.
    """
    db_ok = True
    db_error = None
    try:
        db = SessionLocal()
        try:
            db.execute(text("SELECT 1"))
        finally:
            db.close()
    except Exception as exc:
        db_ok = False
        db_error = str(exc)
        logger.warning("Health check DB ping failed: %s", exc)

    payload = {"status": "ok" if db_ok else "degraded", "database": "ok" if db_ok else "down"}
    status_code = 200 if db_ok else 503
    return JSONResponse(status_code=status_code, content=payload)
