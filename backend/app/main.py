import asyncio
import logging
import os
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import text

from app.config import settings
from app.database import Base, SessionLocal, engine, run_lightweight_migrations
from app.middleware import AuthRateLimiter, BodySizeLimiter, RequestIDMiddleware, SecurityHeadersMiddleware
from app.routers import auth, stocks, portfolio, watchlist, history, feedback, admin, screener, paper_trading, ai, analysis, memos, ticker_hub, earnings, news, notifications, digest
from app.services import market_data
from app.services.auto_fixer import run_auto_fixer
from app.services.snapshot_scheduler import snapshot_scheduler_loop

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Process-liveness flag. Flipped True the moment the ASGI app finishes booting,
# regardless of whether the database is reachable. The liveness probe
# (/health/live) reads this so a DB outage NEVER makes the orchestrator think
# the process is dead and trigger a restart loop. Readiness (/health) is a
# separate, DB-dependent check used only for traffic routing / monitoring.
_process_alive = False

# Set True once Base.metadata.create_all has succeeded at least once. Until
# then, a background task keeps retrying so the app self-heals when the DB
# comes back, instead of crashing at boot.
_schema_ready = False


async def _ensure_schema(max_attempts: int = 5) -> bool:
    """Create tables, retrying with exponential backoff.

    Returns True on success. Never raises — a persistent failure is logged and
    the caller decides whether to keep the process alive (it does).
    `create_all` is idempotent (checkfirst=True), so retrying is always safe.
    """
    global _schema_ready
    delay = 1.0
    for attempt in range(1, max_attempts + 1):
        try:
            await asyncio.to_thread(Base.metadata.create_all, bind=engine)
            await asyncio.to_thread(run_lightweight_migrations)
            _schema_ready = True
            logger.info("Database schema ready (attempt %d).", attempt)
            return True
        except Exception as exc:
            logger.warning(
                "Schema init attempt %d/%d failed: %s", attempt, max_attempts, exc
            )
            if attempt < max_attempts:
                await asyncio.sleep(delay)
                delay = min(delay * 2, 30)  # cap backoff at 30s
    return False


async def _schema_retry_loop() -> None:
    """Keep retrying schema init forever until it succeeds, then exit.

    Spawned only when the initial bounded retry fails. This is what makes a
    cold DB (or a credential rotation that's mid-propagation) self-heal: the
    web process stays up serving 503s on data endpoints, and the instant the
    DB becomes reachable this loop creates the schema and flips _schema_ready.
    """
    while not _schema_ready:
        await asyncio.sleep(15)
        logger.info("[schema-retry] Retrying database schema init…")
        if await _ensure_schema(max_attempts=1):
            logger.info("[schema-retry] Database recovered — schema is ready.")
            return


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _process_alive

    # Resilient startup: try to init the schema, but NEVER let a DB failure
    # crash the boot. If the DB is unreachable we still come up (degraded) and
    # a background loop self-heals when it returns. This is the guardrail that
    # turns a transient DB/credential issue from a permanent outage (Fly gives
    # up after 10 crash-restarts) into a recoverable degraded state.
    # Keep the boot attempt short (≈3s worst case: delays 1s+2s) so uvicorn
    # opens the port well within Fly's health-check grace period. Longer
    # outages are handled by the background _schema_retry_loop below.
    if not await _ensure_schema(max_attempts=3):
        logger.error(
            "Database unreachable at startup — booting in DEGRADED mode. "
            "Data endpoints will return 503 until the DB recovers; the process "
            "stays alive and self-heals. Liveness=OK, Readiness=DOWN."
        )

    _process_alive = True

    def _on_task_done(t: asyncio.Task) -> None:
        if not t.cancelled() and (exc := t.exception()):
            logger.error("Background task '%s' raised an unhandled exception: %s", t.get_name(), exc)

    # If the DB was unreachable at boot, keep retrying in the background so the
    # process self-heals the moment the DB returns. Cancelled on shutdown.
    schema_retry_task: asyncio.Task | None = None
    if not _schema_ready:
        schema_retry_task = asyncio.create_task(_schema_retry_loop(), name="schema-retry-loop")
        schema_retry_task.add_done_callback(_on_task_done)

    warm_task = asyncio.create_task(_warm_screener(), name="screener-warmup")
    warm_task.add_done_callback(_on_task_done)

    # The market-overview cache and its refresh loop live in per-process memory,
    # so the design assumes a single worker. Warn loudly if that's not the case
    # rather than silently serving divergent caches and N× yfinance load.
    try:
        worker_count = int(os.getenv("WEB_CONCURRENCY", "1") or "1")
    except ValueError:
        worker_count = 1
    if worker_count > 1:
        logger.warning(
            "WEB_CONCURRENCY=%d but the market-overview cache/refresh loop are "
            "per-process. Each worker keeps its own cache and hits yfinance "
            "independently. Run a single worker or move the cache to shared "
            "storage (e.g. Redis).",
            worker_count,
        )

    overview_task = asyncio.create_task(stocks.warm_overview(), name="overview-warmup")
    overview_task.add_done_callback(_on_task_done)

    # Autonomous loop that keeps the real-time market-overview cache warm so
    # stock data always loads instantly, regardless of traffic. Cancelled on
    # shutdown below.
    overview_refresh_task = asyncio.create_task(
        stocks.refresh_overview_loop(), name="overview-refresh-loop"
    )
    overview_refresh_task.add_done_callback(_on_task_done)

    # Same pattern for /market/update and /screener: a single background
    # refresher per process keeps the cache warm so every user request hits
    # memory, never yfinance. This is what makes the API stay fast as user
    # traffic grows — without it, every TTL expiry triggered a thundering
    # herd of full-universe batch fetches that deepened Yahoo's throttle.
    update_refresh_task = asyncio.create_task(
        market_data.refresh_market_update_loop(), name="market-update-refresh-loop"
    )
    update_refresh_task.add_done_callback(_on_task_done)

    screener_refresh_task = asyncio.create_task(
        market_data.refresh_screener_loop(), name="screener-refresh-loop"
    )
    screener_refresh_task.add_done_callback(_on_task_done)

    # Hourly portfolio snapshot scheduler — fills history rows for users who
    # haven't opened the app today. Without this, the history chart has gaps
    # for inactive users (the analytics endpoint only writes a row on demand).
    snapshot_task = asyncio.create_task(snapshot_scheduler_loop(), name="snapshot-scheduler-loop")
    snapshot_task.add_done_callback(_on_task_done)

    fix_task: asyncio.Task | None = None
    if settings.auto_fixer_enabled:
        logger.info("Auto-fixer ENABLED — running every %d hours.", settings.auto_fixer_interval_hours)
        fix_task = asyncio.create_task(_auto_fix_loop(), name="auto-fix-loop")
        fix_task.add_done_callback(_on_task_done)
    else:
        logger.info("Auto-fixer disabled (set AUTO_FIXER_ENABLED=true to enable).")
    logger.info("MarketCap API started")
    yield

    # ── Shutdown ──────────────────────────────────────────────────────────
    # Cancel every long-lived background task we started. Without this,
    # uvicorn prints "Task was destroyed but it is pending" warnings on
    # shutdown and the asyncio loop may close while a refresh loop is mid-
    # tick (e.g., holding a DB session or partial Yahoo response).
    _shutdown_tasks: list[asyncio.Task] = [
        overview_refresh_task,
        update_refresh_task,
        screener_refresh_task,
        snapshot_task,
        warm_task,
        overview_task,
    ]
    if schema_retry_task is not None:
        _shutdown_tasks.append(schema_retry_task)
    if fix_task is not None:
        _shutdown_tasks.append(fix_task)
    for t in _shutdown_tasks:
        t.cancel()
    for t in _shutdown_tasks:
        try:
            await t
        except (asyncio.CancelledError, Exception):
            # Swallow Exception too: a task could raise on cancel cleanup
            # (e.g., the DB went away mid-tick) and we don't want one bad
            # task to skip the rest of the teardown.
            pass

    # Release the yfinance thread pools so the process can exit cleanly.
    # `wait=False` is intentional — at shutdown the orchestrator already
    # SIGTERM'd us; waiting for hung Yahoo connections would block the exit
    # past the grace period and trigger a SIGKILL anyway.
    market_data._pool.shutdown(wait=False)
    market_data._backfill_pool.shutdown(wait=False)
    market_data._info_pool.shutdown(wait=False)
    market_data._download_pool.shutdown(wait=False)
    market_data._screener_batch_pool.shutdown(wait=False)

    logger.info("MarketCap API shutting down")


async def _warm_screener():
    # Stagger behind the overview/market-update warmups. At boot, firing the
    # 2,099-ticker screener .info refill at the same time as the (much
    # lighter) overview and update fetches tripped Yahoo's per-IP rate limit
    # hard enough that NOTHING warmed for many minutes — the dashboard
    # showed nothing after every deploy. Two minutes lets the small caches
    # win the race; the screener then refills against a calmer budget.
    await asyncio.sleep(120)
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


app = FastAPI(
    title="MarketCap API",
    lifespan=lifespan,
    # Hide the interactive API docs and raw schema in production — they expose
    # every endpoint, parameter, and schema to unauthenticated visitors.
    # Set IS_PRODUCTION=true via Fly secret to activate this.
    docs_url=None if settings.is_production else "/docs",
    redoc_url=None if settings.is_production else "/redoc",
    openapi_url=None if settings.is_production else "/openapi.json",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_origin_regex=settings.allowed_origin_regex or None,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "X-Request-ID", "X-Admin-Token"],
)

# Compress JSON/NDJSON responses — the 2,099-row screener stream and the
# market-update payload shrink ~5-10x over the wire, which is most of the
# perceived data-load time on slower connections. (Starlette's GZip
# middleware compresses streaming responses chunk-wise, so the screener's
# progressive rendering is preserved.)
app.add_middleware(GZipMiddleware, minimum_size=1024)

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
app.include_router(portfolio.router)
app.include_router(watchlist.router)
app.include_router(history.router)
app.include_router(feedback.router)
app.include_router(admin.router)
app.include_router(screener.router)
app.include_router(paper_trading.router)
app.include_router(ai.router)
app.include_router(analysis.router)
app.include_router(memos.router)
app.include_router(ticker_hub.router)
app.include_router(earnings.router)
app.include_router(news.router)
app.include_router(notifications.router)
app.include_router(digest.router)


@app.get("/health/live")
def health_live():
    """LIVENESS probe — is the process up? Never touches the DB.

    Point your orchestrator's *restart* trigger (Fly http_checks, k8s
    livenessProbe) HERE. Because it never depends on the database, a DB
    outage can no longer make the platform conclude the process is dead and
    crash-restart it into oblivion. As long as the ASGI app booted, this is
    200 — the process can stay alive and self-heal.
    """
    if not _process_alive:
        return JSONResponse(status_code=503, content={"status": "starting"})
    return JSONResponse(status_code=200, content={"status": "alive"})


@app.get("/health")
def health():
    """READINESS probe — can we actually serve data? Pings the DB.

    Use this for *traffic routing* (k8s readinessProbe), uptime monitors, and
    humans. A failed DB check returns 503 + schema status so callers can see
    whether we're in the self-healing degraded state. A failing readiness
    check must NOT be wired to restart the machine — that's what /health/live
    is for.
    """
    db_ok = True
    try:
        db = SessionLocal()
        try:
            db.execute(text("SELECT 1"))
        finally:
            db.close()
    except Exception as exc:
        db_ok = False
        logger.warning("Health check DB ping failed: %s", exc)

    payload = {
        "status": "ok" if db_ok else "degraded",
        "database": "ok" if db_ok else "down",
        "schema_ready": _schema_ready,
    }
    status_code = 200 if db_ok else 503
    return JSONResponse(status_code=status_code, content=payload)
