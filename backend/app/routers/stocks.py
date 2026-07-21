import asyncio
import json
import logging
import random
import re
import time
from datetime import date, timedelta
from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import StreamingResponse
from app.config import settings
from app.services import market_data

router = APIRouter(prefix="/stocks", tags=["stocks"])
logger = logging.getLogger(__name__)

_TICKER_RE = re.compile(r"^[A-Z0-9.\-]{1,10}$")


def _validate_ticker(ticker: str) -> str:
    """Normalise to uppercase and reject malformed ticker strings."""
    t = ticker.upper().strip()
    if not _TICKER_RE.match(t):
        raise HTTPException(400, "Invalid ticker symbol.")
    return t

# In-process response cache for the heavy market-overview endpoint.
# Without this, every dashboard load triggers fresh yfinance calls for
# indices + top movers — easily 50+ tickers per request.
_OVERVIEW_TTL = 90  # seconds — data older than this triggers a background refresh
_overview_cache: dict | None = None
_overview_ts: float = 0.0
_overview_lock = asyncio.Lock()

CHART_RANGES = {
    "1D": (1, "minute", 1),
    "5D": (5, "minute", 5),
    "1M": (1, "day", 30),
    "6M": (1, "day", 180),
    "1Y": (1, "day", 365),
    "5Y": (1, "week", 365 * 5),
}


@router.get("/search")
async def search(q: str = Query(..., min_length=1, max_length=50)):
    try:
        return await market_data.search_tickers(q)
    except Exception:
        logger.exception("search failed for q=%s", q)
        raise HTTPException(502, "Market data unavailable.")


@router.get("/quotes")
async def quotes_batch(tickers: str = Query(..., min_length=1, max_length=1200)):
    """Batched quotes: one request for a whole portfolio or tab bar instead
    of one request per ticker (the per-row pattern fired 40+ calls/min from
    a single portfolio page). Comma-separated, deduped, capped at 100;
    invalid or failed symbols are omitted rather than failing the batch."""
    symbols: list[str] = []
    seen: set[str] = set()
    for raw in tickers.split(","):
        t = raw.strip().upper()
        if not t or t in seen:
            continue
        seen.add(t)
        symbols.append(t)
        if len(symbols) >= 100:
            break

    async def _one(sym: str):
        return await market_data.get_quote(_validate_ticker(sym))

    results = await asyncio.gather(*(_one(s) for s in symbols), return_exceptions=True)
    return {"results": {s: r for s, r in zip(symbols, results) if not isinstance(r, BaseException)}}


@router.get("/quote/{ticker}")
async def quote(ticker: str):
    t = _validate_ticker(ticker)
    try:
        return await market_data.get_quote(t)
    except ValueError as e:
        raise HTTPException(404, str(e))
    except Exception:
        logger.exception("quote failed for %s", t)
        raise HTTPException(502, "Market data unavailable.")


@router.get("/fundamentals/{ticker}")
async def fundamentals(ticker: str):
    """Compact fundamental snapshot (margins, growth, leverage, valuation
    multiples, DCF base inputs) for the memo builder and comps table."""
    t = _validate_ticker(ticker)
    try:
        return await market_data.get_fundamentals(t)
    except Exception:
        logger.exception("fundamentals failed for %s", t)
        raise HTTPException(502, "Market data unavailable.")


@router.get("/details/{ticker}")
async def details(ticker: str):
    t = _validate_ticker(ticker)
    try:
        return await market_data.get_ticker_details(t)
    except Exception:
        logger.exception("details failed for %s", t)
        raise HTTPException(502, "Market data unavailable.")


@router.get("/chart/{ticker}")
async def chart(ticker: str, range: str = Query("1M", enum=list(CHART_RANGES.keys()))):
    t = _validate_ticker(ticker)
    multiplier, timespan, days = CHART_RANGES[range]
    # yfinance end date is exclusive — add 1 day so today's candle is included
    to_date = date.today() + timedelta(days=1)
    from_date = to_date - timedelta(days=days + 1)
    try:
        return await market_data.get_aggregates(t, multiplier, timespan, str(from_date), str(to_date))
    except Exception:
        logger.exception("chart failed for %s range=%s", t, range)
        raise HTTPException(502, "Market data unavailable.")


@router.get("/income/{ticker}")
async def income_data(ticker: str):
    t = _validate_ticker(ticker)
    try:
        return await market_data.get_income_data(t)
    except Exception:
        logger.exception("income_data failed for %s", t)
        raise HTTPException(502, "Market data unavailable.")


@router.get("/earnings/calendar")
async def earnings_calendar(week_offset: int = Query(0, ge=-4, le=8)):
    """Return earnings events for the given week (0=current, 1=next, etc.)."""
    try:
        return await market_data.get_earnings_calendar(week_offset)
    except Exception:
        logger.exception("earnings_calendar failed")
        raise HTTPException(502, "Earnings data unavailable.")


@router.get("/economic/calendar")
async def economic_calendar(week_offset: int = Query(0, ge=-4, le=8)):
    """Return macro events (Fed, jobs, inflation, GDP) for the given week."""
    try:
        return await market_data.get_economic_calendar(week_offset)
    except Exception:
        logger.exception("economic_calendar failed")
        raise HTTPException(502, "Economic calendar unavailable.")


@router.get("/market/update")
async def market_update():
    try:
        return await market_data.get_market_update()
    except Exception:
        logger.exception("market_update failed")
        raise HTTPException(502, "Market data unavailable.")



@router.get("/screener")
async def screener():
    async def _ndjson():
        try:
            async for stock in market_data.stream_screener():
                yield json.dumps(stock) + "\n"
        except Exception:
            # Never send raw exception strings — they may contain internal paths
            # or upstream error messages. Log server-side and send a generic error.
            logger.exception("screener stream failed mid-stream")
            yield json.dumps({"error": "Data temporarily unavailable."}) + "\n"
    return StreamingResponse(_ndjson(), media_type="application/x-ndjson")


async def _refresh_overview(force: bool = False) -> dict:
    """Fetch fresh overview data and update the cache.

    The lock + freshness re-check guarantee that only ONE upstream yfinance
    fetch runs even when many callers (or a background refresh) race here.
    Pass ``force=True`` (used by the autonomous refresh loop) to bypass the
    freshness check and always pull fresh data.
    """
    global _overview_cache, _overview_ts
    async with _overview_lock:
        # Another coroutine may have refilled the cache while we waited.
        if not force and _overview_cache and (time.time() - _overview_ts) < _OVERVIEW_TTL:
            return _overview_cache
        indices, gl = await asyncio.gather(
            market_data.get_market_indices(),
            market_data.get_gainers_losers(),
        )
        _overview_cache = {
            "indices": indices,
            "gainers": gl["gainers"],
            "losers":  gl["losers"],
        }
        _overview_ts = time.time()
        return _overview_cache


async def warm_overview() -> None:
    """Pre-fill the cache at startup so the first dashboard load is instant."""
    try:
        logger.info("Warming market-overview cache…")
        await _refresh_overview(force=True)
        logger.info("Market-overview cache ready.")
    except Exception as exc:
        logger.warning("Overview warm-up failed: %s", exc)


# Refresh more often than the cache TTL so the payload is never stale and every
# request hits the fast in-memory path. Configured via OVERVIEW_REFRESH_SECONDS
# (validated by pydantic); a 15s floor protects yfinance from being hammered.
_OVERVIEW_REFRESH_INTERVAL = max(15, settings.overview_refresh_seconds)


async def refresh_overview_loop() -> None:
    """Autonomous background loop that keeps the market-overview cache warm.

    This is the single source of cache freshness: each tick forces a fresh
    upstream fetch, so the cached payload is continuously refreshed independent
    of user traffic — real-time stock data always loads instantly with no
    cold-fetch delay, even after idle periods. Transient upstream failures are
    logged and retried on the next tick; the loop never dies on a single error.
    """
    logger.info(
        "Market-overview auto-refresh loop started (every ~%ds).",
        _OVERVIEW_REFRESH_INTERVAL,
    )
    # Jitter + backoff mirror market_data._refresh_loop. We don't share that
    # helper because this loop forces an unconditional fresh fetch (force=True),
    # whereas the shared helper just calls a getter that respects the TTL.
    failures = 0
    while True:
        if failures == 0:
            delay = _OVERVIEW_REFRESH_INTERVAL * (1.0 + random.uniform(-0.15, 0.15))
        else:
            delay = min(30.0 * (2 ** (failures - 1)), 600.0)
            delay *= (1.0 + random.uniform(-0.15, 0.15))
        await asyncio.sleep(delay)
        try:
            await _refresh_overview(force=True)
            failures = 0
            logger.debug("market-overview cache auto-refreshed")
        except Exception as exc:
            failures += 1
            logger.warning("periodic overview refresh failed (#%d): %s", failures, exc)


@router.get("/market/overview")
async def market_overview():
    """Serve the in-memory cache, which ``refresh_overview_loop`` keeps warm.

    Whenever a cached payload exists it is returned immediately — the caller
    never waits on yfinance. Only a completely cold cache (the first request
    after boot, before warm-up finishes) blocks on an upstream fetch.
    """
    if _overview_cache is not None:
        return _overview_cache

    # Cold cache (first minutes after boot). Under a Yahoo rate-limit storm
    # the first fill can take minutes, and every request queued behind
    # _overview_lock used to hang until the browser gave up — the dashboard
    # section simply never rendered. Bound the wait: give the in-flight
    # refresh a short window, then tell the client to retry. A fast 503 +
    # Retry-After lets the frontend poll its way in the moment the cache
    # lands, instead of dying on a 2-minute stalled request.
    try:
        return await asyncio.wait_for(_refresh_overview(), timeout=15)
    except asyncio.TimeoutError:
        raise HTTPException(
            503, "Market data is warming up — retry shortly.",
            headers={"Retry-After": "10"},
        )
    except Exception:
        logger.exception("market_overview failed")
        raise HTTPException(502, "Market data unavailable.")
