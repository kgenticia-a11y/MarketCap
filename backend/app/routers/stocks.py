import asyncio
import json
import logging
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


@router.get("/market/update")
async def market_update():
    try:
        return await market_data.get_market_update()
    except Exception:
        logger.exception("market_update failed")
        raise HTTPException(502, "Market data unavailable.")


@router.get("/funds/categories")
async def fund_categories():
    return market_data.get_fund_categories()


_VALID_FUND_CATEGORIES = {"Broad Market", "Bonds", "International", "Commodities", "Real Assets"}

@router.get("/funds/{category}")
async def funds_by_category(category: str):
    if category not in _VALID_FUND_CATEGORIES:
        raise HTTPException(400, "Invalid fund category.")
    try:
        return await market_data.get_funds(category)
    except Exception:
        logger.exception("funds failed for category=%s", category)
        raise HTTPException(502, "Market data unavailable.")


@router.get("/screener")
async def screener():
    async def _ndjson():
        try:
            async for stock in market_data.stream_screener():
                yield json.dumps(stock) + "\n"
        except Exception as e:
            yield json.dumps({"error": str(e)}) + "\n"
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
        "Market-overview auto-refresh loop started (every %ds).",
        _OVERVIEW_REFRESH_INTERVAL,
    )
    while True:
        await asyncio.sleep(_OVERVIEW_REFRESH_INTERVAL)
        try:
            await _refresh_overview(force=True)
            logger.debug("market-overview cache auto-refreshed")
        except Exception as exc:
            logger.warning("periodic overview refresh failed: %s", exc)


@router.get("/market/overview")
async def market_overview():
    """Serve the in-memory cache, which ``refresh_overview_loop`` keeps warm.

    Whenever a cached payload exists it is returned immediately — the caller
    never waits on yfinance. Only a completely cold cache (the first request
    after boot, before warm-up finishes) blocks on an upstream fetch.
    """
    if _overview_cache is not None:
        return _overview_cache

    try:
        return await _refresh_overview()
    except Exception:
        logger.exception("market_overview failed")
        raise HTTPException(502, "Market data unavailable.")
