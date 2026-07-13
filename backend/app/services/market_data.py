"""
Data service backed entirely by yfinance + Yahoo Finance APIs.
No API key required.
yfinance is synchronous, so every call runs in a thread-pool executor.
"""
import asyncio
import certifi
import logging
import random
import threading
import time
import xml.etree.ElementTree as ET
from collections import OrderedDict
from concurrent.futures import Future, ThreadPoolExecutor, as_completed, wait as fut_wait
from datetime import datetime, timedelta, date, timezone
from typing import Any, Callable, Awaitable

import httpx
import yfinance as yf

from app.config import settings
from app.services.nyse_universe import NYSE_EXPANSION, assert_unique_universe

logger = logging.getLogger(__name__)

# Thread pool size configurable via YF_POOL_SIZE; default 6.
_pool = ThreadPoolExecutor(max_workers=settings.yf_pool_size)

# Smaller dedicated pool for per-ticker fast_info backfill. Sized separately
# from _pool (via YF_BACKFILL_SIZE) so the operator can tune the two knobs
# independently — and so backfill traffic can't starve quotes/charts/details
# of slots on the main pool. Total Yahoo concurrency = yf_pool_size +
# yf_backfill_size must stay under the per-replica throttle ceiling.
_backfill_pool = ThreadPoolExecutor(
    max_workers=settings.yf_backfill_size,
    thread_name_prefix="yf-backfill",
)

# Long-lived pool for bounded `.info` calls. Replaces the previous per-call
# `with ThreadPoolExecutor(max_workers=1) as pool: ...` pattern, which leaked
# the timeout: pool.__exit__ calls shutdown(wait=True), so a slow yfinance
# call always blocked the *whole* timeout budget anyway. Submitting to a
# shared pool and abandoning the future on timeout actually enforces the
# wall-clock cap users see.
_info_pool = ThreadPoolExecutor(
    max_workers=max(4, settings.yf_pool_size),
    thread_name_prefix="yf-info",
)

# Shared pool for chunked batch downloads. _download_chunked previously
# created a throwaway 5-worker pool per call, so overlapping refresh loops
# (overview / market-update / screener — all much longer now at 2,099
# tickers) could stack 10-15+ concurrent Yahoo connections, past the
# ~10-per-replica throttle ceiling documented in config.py. One shared pool
# makes concurrent callers queue behind the same 5 download slots instead
# of multiplying them.
_download_pool = ThreadPoolExecutor(max_workers=5, thread_name_prefix="yf-download")

# Shared pool for the screener's batched `.info` fetches (previously a fresh
# 6-worker pool per 40-ticker batch, uncounted against any budget).
_screener_batch_pool = ThreadPoolExecutor(max_workers=6, thread_name_prefix="yf-screener")


async def _run(fn, *args, **kwargs):
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(_pool, lambda: fn(*args, **kwargs))


# ── Bounded TTL cache ──────────────────────────────────────────────────────
# CPython's GIL makes individual dict reads/writes atomic, so OrderedDict
# operations from concurrent asyncio coroutines are safe without an explicit
# lock as long as we only touch whole entries (never iterate during a write).
#
# Each cache instance bounds memory by evicting the least-recently-used entry
# when it grows past `max_size`. Without the cap, ticker-name churn (search-
# driven quote lookups, ad-hoc charts) made these dicts grow forever in a
# long-running process — a slow OOM that would only bite weeks into uptime.


class _BoundedTTLCache:
    """LRU-bounded TTL cache. Entries are (value, expiry_ts) keyed by string.

    Reads return the entry untouched (callers decide if it's fresh, stale,
    or evictable based on age). `get` promotes the key to most-recent so the
    LRU eviction order matches actual usage, not insertion order.
    """

    def __init__(self, max_size: int):
        self._data: OrderedDict[str, tuple[Any, float]] = OrderedDict()
        self._max = max_size

    def get(self, key: str) -> tuple[Any, float] | None:
        entry = self._data.get(key)
        if entry is None:
            return None
        # Touch — keeps hot tickers from being evicted under churn.
        self._data.move_to_end(key)
        return entry

    def set(self, key: str, value: Any, ts: float) -> None:
        self._data[key] = (value, ts)
        self._data.move_to_end(key)
        # Pop oldest until we're back within budget. Amortised O(1) per call
        # because we only ever grow by one entry per `set`.
        while len(self._data) > self._max:
            self._data.popitem(last=False)

    def __contains__(self, key: str) -> bool:
        return key in self._data

    def __len__(self) -> int:
        return len(self._data)


# Caps are sized generously enough that hot working sets never get evicted,
# but tight enough that a scanner/scraper can't blow the process memory.
_QUOTE_CACHE_MAX   = 4_000
_DETAILS_CACHE_MAX = 4_000
_CHART_CACHE_MAX   = 4_000  # keyed by ticker+range+date, so ~6 ranges × tickers
_quote_cache:   _BoundedTTLCache = _BoundedTTLCache(_QUOTE_CACHE_MAX)
_details_cache: _BoundedTTLCache = _BoundedTTLCache(_DETAILS_CACHE_MAX)
_chart_cache:   _BoundedTTLCache = _BoundedTTLCache(_CHART_CACHE_MAX)
_update_cache:  tuple[dict, float] | None = None
_update_lock = asyncio.Lock()

_QUOTE_TTL   =  30   # seconds — price data refreshes frequently
_DETAILS_TTL = 300   # 5 min  — company fundamentals rarely change intraday
_CHART_1D_TTL  =  60   # 1 min  — intraday candles need to be fairly fresh
_CHART_TTL     = 300   # 5 min  — daily/weekly/monthly candles
_UPDATE_TTL  = 300   # 5 min  — market-update sector/breadth data

# Stale-while-revalidate window. While a cached entry is past its TTL but
# under SWR_MAX, the user gets the cached payload IMMEDIATELY and a fresh
# fetch runs in the background. Past SWR_MAX the cached payload is too old
# to serve and the user blocks on a fresh fetch (correctness over speed).
_QUOTE_SWR_MAX   = _QUOTE_TTL   *  4   # 2 min  — still tradeable
_DETAILS_SWR_MAX = _DETAILS_TTL *  6   # 30 min — descriptive fields rarely change
_CHART_SWR_MAX   = _CHART_TTL   *  3   # 15 min — daily candles
_CHART_1D_SWR_MAX= _CHART_1D_TTL*  3   # 3 min  — intraday

# Single-flight tables: per-key Future for in-flight fetches. Concurrent
# callers waiting on the same key reuse the first Future instead of each
# launching their own yfinance call. The Future is removed when it resolves
# so a future TTL expiry triggers exactly one new fetch.
_inflight_quote:   dict[str, asyncio.Future] = {}
_inflight_details: dict[str, asyncio.Future] = {}
_inflight_chart:   dict[str, asyncio.Future] = {}


async def _singleflight(
    table: dict[str, asyncio.Future],
    key: str,
    coro_fn: Callable[[], Awaitable[Any]],
) -> Any:
    """Coalesce concurrent fetches for the same key.

    If another coroutine is already fetching `key`, await its Future instead
    of launching a duplicate. This is what stops a refresh-loop tick and a
    cold user request from each firing their own yfinance call for the same
    ticker at the same instant.
    """
    existing = table.get(key)
    if existing is not None:
        try:
            return await existing
        except Exception:
            # Fall through: the previous attempt failed, retry under a fresh
            # Future. We don't want one bad fetch to poison all later callers.
            pass

    loop = asyncio.get_running_loop()
    fut: asyncio.Future = loop.create_future()
    table[key] = fut
    try:
        result = await coro_fn()
    except Exception as exc:
        if not fut.done():
            fut.set_exception(exc)
        raise
    else:
        if not fut.done():
            fut.set_result(result)
        return result
    finally:
        # Always clear the slot so the *next* TTL expiry can launch a new
        # fetch. Leaving a completed Future in the table would otherwise
        # stick around forever and serve stale results.
        if table.get(key) is fut:
            table.pop(key, None)


def _swr_serve_and_refresh(
    key: str,
    cached: tuple[Any, float],
    inflight: dict[str, asyncio.Future],
    fetch_fn: Callable[[], Awaitable[Any]],
) -> Any:
    """Fire-and-forget refresh for stale-while-revalidate. Returns the cached
    value immediately. The background refresh is coalesced through
    `_singleflight`, so a rush of stale hits doesn't fan out into multiple
    yfinance calls — exactly one runs.
    """
    if key not in inflight:
        async def _bg() -> None:
            try:
                await _singleflight(inflight, key, fetch_fn)
            except Exception as exc:
                logger.debug("SWR background refresh for %s failed: %s", key, exc)
        asyncio.create_task(_bg())
    return cached[0]


# ── Quote ──────────────────────────────────────────────────────────────────

def _fetch_quote(ticker: str) -> dict:
    t = yf.Ticker(ticker)
    try:
        fi = t.fast_info
    except KeyError:
        raise ValueError(f"Ticker '{ticker}' not found")

    triple = _fast_info_price_change(fi)
    stale = False
    if triple is not None:
        price, prev, change_pct = triple
    else:
        # No fresh print; fall back to the previous close so /quote keeps
        # serving a sensible row instead of 404-ing intraday on a thin name.
        # Breadth's backfill path treats None as "skip" — see the helper docstring.
        last = fi.last_price
        prev = fi.previous_close
        price = last or prev or 0
        if not price:
            raise ValueError(f"Ticker '{ticker}' not found")
        # If we only have a previous close, the print is from a prior session.
        # Reporting change_pct=0 here silently masquerades stale data as
        # "unchanged today", which trips alert evaluators and the watchlist
        # UI. Surface the staleness so callers can render or filter it.
        change_pct = 0.0
        stale = True

    return {
        "ticker": ticker.upper(),
        "price": round(price, 4),
        "previous_close": round(prev or 0, 4),
        "open": round(fi.open or 0, 4),
        "high": round(fi.day_high or 0, 4),
        "low": round(fi.day_low or 0, 4),
        "volume": int(fi.last_volume or 0),
        "change_pct": round(change_pct, 4),
        "stale": stale,
    }


async def _fetch_quote_async(t: str) -> dict:
    result = await _run(_fetch_quote, t)
    _quote_cache.set(t, result, time.time())
    return result


async def get_quote(ticker: str) -> dict:
    """Return a full quote dict: price, previous close, change %, volume, etc.

    Caching strategy:
      - fresh (age < TTL)            → cached, no upstream hit
      - stale (TTL ≤ age < SWR_MAX)  → cached, background refresh
      - cold/expired                 → block on single-flight fetch
    """
    t = ticker.upper()
    now = time.time()
    entry = _quote_cache.get(t)
    if entry is not None:
        age = now - entry[1]
        if age < _QUOTE_TTL:
            return entry[0]
        if age < _QUOTE_SWR_MAX:
            return _swr_serve_and_refresh(
                t, entry, _inflight_quote, lambda: _fetch_quote_async(t)
            )
    return await _singleflight(_inflight_quote, t, lambda: _fetch_quote_async(t))


# ── Chart ──────────────────────────────────────────────────────────────────

def _fetch_chart(ticker: str, multiplier: int, timespan: str, from_date: str, to_date: str) -> dict:
    if timespan == "minute":
        interval = f"{multiplier}m"
        period = "1d" if multiplier <= 1 else "5d"
        hist = yf.Ticker(ticker).history(period=period, interval=interval)
    elif timespan == "week":
        hist = yf.Ticker(ticker).history(start=from_date, end=to_date, interval="1wk")
    else:
        hist = yf.Ticker(ticker).history(start=from_date, end=to_date, interval="1d")

    results = []
    for ts, row in hist.iterrows():
        results.append({
            "t": int(ts.timestamp() * 1000),
            "o": round(float(row["Open"]), 4),
            "h": round(float(row["High"]), 4),
            "l": round(float(row["Low"]), 4),
            "c": round(float(row["Close"]), 4),
            "v": int(row["Volume"]),
        })
    return {"results": results, "status": "OK"}


async def _fetch_chart_async(
    cache_key: str, t: str, multiplier: int, timespan: str, from_date: str, to_date: str
) -> dict:
    result = await _run(_fetch_chart, t, multiplier, timespan, from_date, to_date)
    _chart_cache.set(cache_key, result, time.time())
    return result


async def get_aggregates(ticker: str, multiplier: int, timespan: str, from_date: str, to_date: str) -> dict:
    t = ticker.upper()
    cache_key = f"{t}:{timespan}:{multiplier}:{from_date}:{to_date}"
    is_intraday = timespan == "minute"
    ttl = _CHART_1D_TTL if is_intraday else _CHART_TTL
    swr_max = _CHART_1D_SWR_MAX if is_intraday else _CHART_SWR_MAX
    now = time.time()
    entry = _chart_cache.get(cache_key)
    if entry is not None:
        age = now - entry[1]
        if age < ttl:
            return entry[0]
        if age < swr_max:
            return _swr_serve_and_refresh(
                cache_key, entry, _inflight_chart,
                lambda: _fetch_chart_async(cache_key, t, multiplier, timespan, from_date, to_date),
            )
    return await _singleflight(
        _inflight_chart, cache_key,
        lambda: _fetch_chart_async(cache_key, t, multiplier, timespan, from_date, to_date),
    )


# ── Search ─────────────────────────────────────────────────────────────────

async def search_tickers(query: str, limit: int = 10) -> dict:
    url = "https://query1.finance.yahoo.com/v1/finance/search"
    try:
        async with httpx.AsyncClient(timeout=8, verify=certifi.where()) as client:
            r = await client.get(url, params={"q": query, "quotesCount": limit, "newsCount": 0},
                                 headers={"User-Agent": "Mozilla/5.0"})
            r.raise_for_status()
            quotes = r.json().get("quotes", [])
    except Exception:
        return {"results": []}

    return {"results": [
        {"ticker": q.get("symbol", ""), "name": q.get("shortname") or q.get("longname", "")}
        for q in quotes
        if q.get("quoteType") in ("EQUITY", "ETF")
    ][:limit]}


# ── Company Details ────────────────────────────────────────────────────────

# yf.Ticker.info triggers a heavy quoteSummary call that can take 5-15s on a
# cold cache. fast_info is a single lightweight endpoint that returns
# market_cap (and price data) almost instantly, so we use it as the primary
# source for market_cap and cap .info to a hard timeout for the rest.
_INFO_TIMEOUT = 5  # seconds


def _info_with_timeout(ticker: str, timeout: float) -> dict:
    """yf.Ticker(ticker).info bounded by a wall-clock timeout.

    The previous implementation used `with ThreadPoolExecutor(max_workers=1)
    as pool:` and submitted a single job. `__exit__` calls `shutdown(wait=
    True)`, which blocks until the worker completes — so the apparent
    "timeout" was a lie: a slow yfinance call always consumed its full
    duration before this function returned. Submitting to a long-lived
    shared pool and abandoning the future on timeout actually enforces the
    cap a caller sees. The abandoned worker still runs to completion in the
    pool (we can't cancel a synchronous yfinance call), but the request
    handler / batch loop is freed immediately."""
    fut = _info_pool.submit(lambda: yf.Ticker(ticker).info)
    try:
        return fut.result(timeout=timeout)
    except Exception:
        return {}


def _fetch_details(ticker: str) -> dict:
    t = yf.Ticker(ticker)

    # Fast path: market cap from fast_info (single lightweight request).
    try:
        market_cap = t.fast_info.market_cap or 0
    except Exception:
        market_cap = 0

    # Slow path: full .info for descriptive fields, bounded so a slow
    # upstream call can never blow the overall response budget.
    info = _info_with_timeout(ticker, _INFO_TIMEOUT)

    return {"results": {
        "ticker": ticker.upper(),
        "name": info.get("longName") or info.get("shortName", ""),
        "description": info.get("longBusinessSummary", ""),
        "market_cap": info.get("marketCap") or market_cap,
        "total_employees": info.get("fullTimeEmployees", 0),
        "pe_ratio": info.get("trailingPE"),
        "week_52_high": info.get("fiftyTwoWeekHigh"),
        "week_52_low": info.get("fiftyTwoWeekLow"),
        "sector": info.get("sector", ""),
        "industry": info.get("industry", ""),
    }}


async def _fetch_details_async(t: str) -> dict:
    result = await _run(_fetch_details, t)
    _details_cache.set(t, result, time.time())
    return result


async def get_ticker_details(ticker: str) -> dict:
    t = ticker.upper()
    now = time.time()
    entry = _details_cache.get(t)
    if entry is not None:
        age = now - entry[1]
        if age < _DETAILS_TTL:
            return entry[0]
        if age < _DETAILS_SWR_MAX:
            return _swr_serve_and_refresh(
                t, entry, _inflight_details, lambda: _fetch_details_async(t)
            )
    return await _singleflight(_inflight_details, t, lambda: _fetch_details_async(t))


# ── Market Overview ────────────────────────────────────────────────────────

def _fetch_indices() -> list[dict]:
    results = []
    for ticker in ["SPY", "QQQ", "DIA"]:
        try:
            results.append(_fetch_quote(ticker))
        except Exception:
            pass
    return results


async def get_market_indices() -> list[dict]:
    return await _run(_fetch_indices)


# Canonical stock universe — the single source of truth for breadth,
# gainers/losers, the screener, and every other "all tracked stocks" view.
# Sectors are evenly represented so the breadth bar and the screener cover
# the same set; a stock that appears in one always appears in the others.
# The 599-stock core list below is extended with the 1,500-stock NYSE
# expansion (nyse_universe.py) for a combined universe of 2,099.
_UNIVERSE = [
    # Technology (60)
    "AAPL", "MSFT", "NVDA", "AMD", "INTC", "CSCO", "ORCL", "CRM", "ADBE", "QCOM",
    "TXN", "AMAT", "AVGO", "MU", "IBM", "INTU", "NOW", "SNOW", "PLTR", "CRWD",
    "PANW", "NET", "ZS", "FTNT", "DDOG", "TEAM", "MDB", "HPQ", "DELL", "SHOP",
    "XYZ", "ZM", "UBER", "LYFT", "TWLO", "OKTA", "DOCU", "ADI", "LRCX", "KLAC",
    "WDAY", "HUBS", "VEEV", "CDNS", "SNPS", "KEYS", "MPWR", "ON", "MCHP", "NXPI",
    "SWKS", "AKAM", "FFIV", "ANET", "GDDY", "TTD", "BILL", "PAYC", "SMCI", "ARM",
    # Financials (60)
    "JPM", "GS", "BAC", "WFC", "MS", "V", "MA", "PYPL", "AXP", "BLK",
    "C", "USB", "PNC", "COF", "SCHW", "ICE", "CME", "TFC", "SPGI", "MCO",
    "MSCI", "NDAQ", "TROW", "FISV", "FIS", "ADP", "COIN", "BRK-B", "ALLY", "MTB",
    "KEY", "CFG", "HBAN", "RF", "ZION", "FITB", "FHN", "SYF", "MKTX", "CBOE",
    "RJF", "LPLA", "NTRS", "STT", "BK", "AIG", "MET", "PRU", "ALL", "TRV",
    "CINF", "GL", "IBKR", "WRB", "ACGL", "HIG", "L", "VOYA", "EQH", "FNF",
    # Healthcare (60)
    "JNJ", "PFE", "MRK", "ABBV", "UNH", "LLY", "AMGN", "GILD", "CVS", "BMY",
    "BIIB", "REGN", "ISRG", "BSX", "MDT", "ZBH", "DHR", "MRNA", "VRTX", "HUM",
    "CI", "ELV", "ABT", "ZTS", "TMO", "A", "IQV", "SYK", "BDX", "EW",
    "ALGN", "LH", "IDXX", "ILMN", "WAT", "CRL", "PODD", "MOH", "CNC", "HCA",
    "GEHC", "RMD", "WST", "TFX", "BAX", "VTRS", "INCY", "JAZZ", "DXCM", "TECH",
    "MEDP", "NBIX", "PEN", "HALO", "INSM", "IONS", "NVCR", "XRAY", "HSIC", "GMED",
    # Consumer Discretionary (59)
    "AMZN", "TSLA", "HD", "LOW", "NKE", "MCD", "SBUX", "CMG", "TGT", "COST",
    "F", "GM", "BKNG", "ABNB", "MAR", "HLT", "EBAY", "LVS", "LULU", "TJX",
    "DG", "DLTR", "AZO", "ORLY", "KR", "ROST", "BBY", "DHI", "LEN", "PHM",
    "POOL", "RH", "DECK", "ETSY", "W", "CPRT", "KMX", "YUM", "DPZ", "QSR",
    "WYNN", "MGM", "CCL", "RCL", "NCLH", "GRMN", "TSCO", "ULTA", "TPR", "RL",
    "PVH", "ONON", "VFC", "CROX", "BIRK", "AEO", "BURL", "FIVE", "CAVA",
    # Communication Services (41)
    "META", "GOOGL", "NFLX", "DIS", "T", "VZ", "SNAP", "PINS", "RBLX", "EA",
    "WBD", "ROKU", "SPOT", "TMUS", "CMCSA", "CHTR", "LYV", "MTCH", "FOXA", "OMC",
    "TTWO", "NWSA", "WMG", "FOX", "IMAX", "CHWY", "IAC", "ZG", "LBRDA", "VRSN",
    "CARG", "CARS", "TKO", "GTN", "NXST", "CNK", "MSGS", "SIRI", "IRDM", "DBX",
    "RAMP",
    # Energy (40)
    "XOM", "CVX", "COP", "SLB", "EOG", "OXY", "PSX", "VLO", "MPC", "HAL",
    "DVN", "BKR", "FANG", "APA", "AR", "EQT", "TRGP", "WMB", "KMI", "OKE",
    "CTRA", "SM", "RRC", "CNX", "MGY", "CHRD", "DINO", "MTDR", "PR", "VNOM",
    "PTEN", "HP", "NOV", "FTI", "WHD", "LBRT", "RIG", "VAL", "WFRD", "TDW",
    # Industrials (59)
    "BA", "GE", "CAT", "HON", "UPS", "DE", "LMT", "RTX", "NOC", "GD",
    "MMM", "EMR", "ETN", "FDX", "UNP", "CSX", "NSC", "WM", "TT", "ROK",
    "DOV", "AME", "PCAR", "CMI", "IR", "PH", "ITW", "SWK", "FAST", "ODFL",
    "CHRW", "XPO", "GNRC", "OTIS", "CARR", "PWR", "EME", "HUBB", "WCC", "ALLE",
    "AYI", "ROP", "NDSN", "SITE", "WSO", "GGG", "AIT", "MAS", "AAON", "TREX",
    "AWI", "BLDR", "OC", "IEX", "AGCO", "TTC", "WAB", "GWW", "SNA",
    # Consumer Staples (35)
    "WMT", "PG", "KO", "PEP", "CL", "MDLZ", "STZ", "MO", "PM", "EL",
    "HSY", "SJM", "KVUE", "GIS", "CPB", "HRL", "MKC", "CHD", "CLX", "BG",
    "MNST", "LW", "KHC", "POST", "SFM", "CASY", "SMPL", "FLO", "BRBR", "INGR",
    "CAG", "USFD", "PFGC", "SYY", "KDP",
    # Materials (35)
    "FCX", "NEM", "LIN", "DOW", "DD", "NUE", "ALB", "SHW", "PPG", "ECL",
    "IFF", "APD", "CE", "EMN", "RPM", "VMC", "MLM", "BALL", "PKG", "IP",
    "STLD", "RS", "ATI", "CLF", "AA", "CF", "MOS", "SMG", "FMC", "AXTA",
    "AVNT", "CBT", "HUN", "OLN", "CC",
    # Real Estate (32)
    "AMT", "PLD", "SPG", "O", "EQR", "EQIX", "CCI", "DLR", "PSA", "WELL",
    "CBRE", "VICI", "ARE", "MAA", "UDR", "ESS", "INVH", "SUI", "ELS", "COLD",
    "REXR", "CUBE", "SBRA", "CPT", "KRG", "REG", "FRT", "IRM", "SBAC", "WPC",
    "NNN", "GLPI",
    # Utilities (28)
    "NEE", "DUK", "SO", "D", "AEP", "XEL", "WEC", "AWK", "AES", "PEG",
    "ED", "EIX", "ES", "FE", "CMS", "CNP", "NI", "DTE", "CEG", "VST",
    "NRG", "SRE", "PNW", "EVRG", "ATO", "OGE", "AVA", "LNT",
    # Fintech / Growth (25)
    "RIVN", "SOFI", "HOOD", "RKLB", "AFRM", "UPST", "DASH", "DKNG", "TOST", "NU",
    "IONQ", "CELH", "HIMS", "SOUN", "JOBY", "RXRX", "MSTR", "MARA", "RIOT", "HUT",
    "CLSK", "WULF", "BTDR", "CIFR", "IREN",
    # Tech II — Semiconductors / Software (50)
    "CRDO", "ONTO", "COHR", "FLEX", "JBL", "GLW", "TEL", "APH", "CDW", "ENPH",
    "FSLR", "WDC", "STX", "NTAP", "QLYS", "GEN", "IOT", "DUOL", "FOUR", "GTLB",
    "S", "DOCN", "DT", "NTNX", "BOX", "FICO", "ASAN", "RNG", "CWAN", "WEX",
    "VRNS", "TENB", "BSY", "CVLT", "PEGA", "RPD", "PI", "BRZE", "APPN", "MTSI",
    "NOVT", "GWRE", "PCOR", "CALX", "SMTC", "SEDG", "RUN", "CIEN", "LITE", "RMBS",
    # International ADRs (15)
    "TSM", "ASML", "SAP", "TM", "SONY", "NVO", "BABA", "JD", "PDD", "MELI",
    "SE", "INFY", "WIT", "HDB", "IBN",
]
# Real runtime check (see assert_unique_universe — it must survive prod).
# Freeze as a tuple so aliasing (_SCREENER_UNIVERSE = _UNIVERSE below) can't
# accidentally mutate the canonical list via the alias.
assert_unique_universe("_UNIVERSE core", _UNIVERSE, expected=599)
# Append the NYSE expansion (1,500 NYSE-only common stocks, largest market
# cap first — see nyse_universe.py for the selection rules). The combined
# size is derived from the two pinned lists, so only a cross-list duplicate
# can fail here — and the error names it.
_UNIVERSE = _UNIVERSE + list(NYSE_EXPANSION)
assert_unique_universe("_UNIVERSE (core + NYSE expansion)", _UNIVERSE)
_UNIVERSE = tuple(_UNIVERSE)


def _fetch_gainers_losers() -> dict:
    # Download 2 days so we can compute prev-close → last-close change
    raw = _download_chunked(_UNIVERSE, period="2d")
    close = raw["Close"]

    have: dict[str, tuple[float, float]] = {}
    if len(close) >= 2:
        last = close.iloc[-1]
        prev = close.iloc[-2]
        for ticker in _UNIVERSE:
            try:
                p  = float(last[ticker])
                pr = float(prev[ticker])
                if p == p and pr == pr and pr > 0:
                    have[ticker] = (p, ((p - pr) / pr * 100))
            except Exception:
                pass

    # Fill in any tickers Yahoo NaN'd so the gainers/losers are picked from
    # the full canonical universe, not just the subset that batch-fetched.
    # Runs even when the batch returned fewer than 2 rows — that's exactly
    # the case where the safety net matters most.
    _backfill_missing(_UNIVERSE, have)

    if not have:
        return {"gainers": [], "losers": []}

    stocks = [
        {"ticker": t, "price": round(price, 2), "change_pct": round(chg, 2), "volume": 0}
        for t, (price, chg) in have.items()
    ]
    stocks.sort(key=lambda x: x["change_pct"], reverse=True)
    return {"gainers": stocks[:6], "losers": list(reversed(stocks[-6:]))}


async def get_gainers_losers() -> dict:
    # The market-update refresh loop already downloads the full universe
    # every ~4.5 min and keeps its result warm. Serve gainers/losers from
    # that cache instead of re-downloading 2,099 tickers on the overview's
    # faster (~60s) cadence — the two loops were independently duplicating
    # the app's single heaviest fetch. Fall back to a direct fetch only
    # while the update cache is cold or stale (first seconds after boot,
    # or a prolonged upstream outage).
    if _update_cache is not None and time.time() - _update_cache[1] < _UPDATE_TTL:
        update = _update_cache[0]
        gainers = [dict(s, volume=0) for s in update["gainers"][:6]]
        losers = [dict(s, volume=0) for s in update["losers"][:6]]
        if gainers or losers:
            return {"gainers": gainers, "losers": losers}
    return await _run(_fetch_gainers_losers)


# ── Income / Dividend Data ─────────────────────────────────────────────────

def _fetch_income_data(ticker: str) -> dict:
    t = yf.Ticker(ticker)
    info = t.info
    fi = t.fast_info

    price         = fi.last_price or fi.previous_close or 0
    dividend_rate = info.get("dividendRate") or 0   # $ per share / year
    # Compute yield directly from rate/price for accuracy
    dividend_yield = (dividend_rate / price * 100) if price > 0 and dividend_rate > 0 else 0
    payout_ratio   = (info.get("payoutRatio") or 0) * 100

    # Format ex-dividend date
    raw_ex = info.get("exDividendDate")
    try:
        # Yahoo sends UTC-midnight timestamps; naive fromtimestamp() shifted
        # the displayed date by a day on any non-UTC host.
        ex_div_date = datetime.fromtimestamp(int(raw_ex), tz=timezone.utc).strftime("%b %d, %Y") if raw_ex else ""
    except Exception:
        ex_div_date = ""

    # 5-year CAGR from monthly close history
    try:
        hist = t.history(period="5y", interval="1mo")
        if len(hist) >= 2:
            start_p = float(hist["Close"].iloc[0])
            end_p   = float(hist["Close"].iloc[-1])
            years   = len(hist) / 12
            cagr    = ((end_p / start_p) ** (1 / years) - 1) * 100 if start_p > 0 else 0
        else:
            cagr = 0.0
    except Exception:
        cagr = 0.0

    return {
        "ticker": ticker,
        "name": info.get("longName") or info.get("shortName", ticker),
        "price": round(price, 2),
        "dividend_yield": round(dividend_yield, 4),
        "dividend_rate": round(dividend_rate, 4),
        "ex_dividend_date": ex_div_date,
        "payout_ratio": round(payout_ratio, 2),
        "five_year_cagr": round(cagr, 2),
    }


async def get_income_data(ticker: str) -> dict:
    return await _run(_fetch_income_data, ticker.upper())


# ── Analyst Report Data ───────────────────────────────────────────────────

_TIMESPAN_TO_PERIOD = {"1M": "1mo", "6M": "6mo", "1Y": "1y", "5Y": "5y"}


def _fetch_analyst_report_data(ticker: str, timespan: str) -> dict:
    t = yf.Ticker(ticker)

    info: dict = {}
    try:
        info = _bounded_info(ticker, timeout=5.0)
    except Exception:
        logger.warning("analyst-report: .info failed for %s", ticker)

    financials_data: dict = {"annual_revenue": [], "annual_net_income": [],
                             "annual_gross_profit": [], "annual_operating_income": []}
    try:
        fin = t.financials
        if fin is not None and not fin.empty:
            for row_name, key in [
                ("Total Revenue", "annual_revenue"),
                ("Net Income", "annual_net_income"),
                ("Gross Profit", "annual_gross_profit"),
                ("Operating Income", "annual_operating_income"),
            ]:
                if row_name in fin.index:
                    row = fin.loc[row_name].dropna()
                    financials_data[key] = [
                        {"year": str(col.year) if hasattr(col, "year") else str(col), "value": float(v)}
                        for col, v in sorted(row.items(), key=lambda x: str(x[0]))
                    ][-4:]
    except Exception:
        logger.warning("analyst-report: .financials failed for %s", ticker)

    balance: dict = {}
    try:
        bs = t.balance_sheet
        if bs is not None and not bs.empty:
            latest = bs.iloc[:, 0]
            for field in ["Total Assets", "Total Liabilities Net Minority Interest",
                          "Stockholders Equity", "Total Debt",
                          "Cash And Cash Equivalents"]:
                if field in latest.index:
                    balance[field] = float(latest[field]) if latest[field] == latest[field] else None
    except Exception:
        logger.warning("analyst-report: .balance_sheet failed for %s", ticker)

    cashflow_data: dict = {}
    try:
        cf = t.cashflow
        if cf is not None and not cf.empty:
            latest = cf.iloc[:, 0]
            for field in ["Operating Cash Flow", "Free Cash Flow", "Capital Expenditure"]:
                if field in latest.index:
                    cashflow_data[field] = float(latest[field]) if latest[field] == latest[field] else None
    except Exception:
        logger.warning("analyst-report: .cashflow failed for %s", ticker)

    price_history: list = []
    try:
        period = _TIMESPAN_TO_PERIOD.get(timespan, "1y")
        hist = t.history(period=period)
        if hist is not None and not hist.empty:
            for idx, row in hist.iterrows():
                price_history.append({
                    "t": int(idx.timestamp() * 1000),
                    "o": round(float(row.get("Open", 0)), 2),
                    "h": round(float(row.get("High", 0)), 2),
                    "l": round(float(row.get("Low", 0)), 2),
                    "c": round(float(row.get("Close", 0)), 2),
                    "v": int(row.get("Volume", 0)),
                })
    except Exception:
        logger.warning("analyst-report: .history failed for %s", ticker)

    recs_history: list = []
    try:
        recs = t.recommendations
        if recs is not None and not recs.empty:
            for _, row in recs.tail(10).iterrows():
                recs_history.append({
                    "date": str(row.name)[:10] if hasattr(row.name, "isoformat") else str(row.name)[:10],
                    "firm": str(row.get("Firm", "")),
                    "to_grade": str(row.get("To Grade", "")),
                    "action": str(row.get("Action", "")),
                })
    except Exception:
        logger.warning("analyst-report: .recommendations failed for %s", ticker)

    g = info.get
    fi = t.fast_info
    price = float(fi.last_price) if fi.last_price else g("currentPrice", 0)
    prev_close = float(fi.previous_close) if fi.previous_close else g("previousClose", 0)
    change_pct = ((price - prev_close) / prev_close * 100) if prev_close else 0

    return {
        "company": {
            "name": g("longName") or g("shortName", ticker),
            "description": g("longBusinessSummary", ""),
            "sector": g("sector", ""),
            "industry": g("industry", ""),
            "employees": g("fullTimeEmployees"),
            "market_cap": g("marketCap"),
        },
        "quote": {
            "price": round(price, 2),
            "change_pct": round(change_pct, 2),
            "volume": g("volume"),
            "week_52_high": g("fiftyTwoWeekHigh"),
            "week_52_low": g("fiftyTwoWeekLow"),
        },
        "financials": financials_data,
        "margins": {
            "gross": g("grossMargins"),
            "operating": g("operatingMargins"),
            "profit": g("profitMargins"),
            "ebitda": g("ebitdaMargins"),
        },
        "valuation": {
            "pe": g("trailingPE"),
            "forward_pe": g("forwardPE"),
            "ps": g("priceToSalesTrailing12Months"),
            "pb": g("priceToBook"),
            "ev_to_revenue": g("enterpriseToRevenue"),
            "ev_to_ebitda": g("enterpriseToEbitda"),
            "enterprise_value": g("enterpriseValue"),
        },
        "growth": {
            "revenue_growth": g("revenueGrowth"),
            "earnings_growth": g("earningsGrowth"),
        },
        "health": {
            "debt_to_equity": g("debtToEquity"),
            "current_ratio": g("currentRatio"),
            "roe": g("returnOnEquity"),
            "roa": g("returnOnAssets"),
            "fcf": g("freeCashflow") or cashflow_data.get("Free Cash Flow"),
            "operating_cf": g("operatingCashflow") or cashflow_data.get("Operating Cash Flow"),
            "total_debt": g("totalDebt") or balance.get("Total Debt"),
        },
        "analyst_targets": {
            "high": g("targetHighPrice"),
            "low": g("targetLowPrice"),
            "mean": g("targetMeanPrice"),
            "median": g("targetMedianPrice"),
            "num_analysts": g("numberOfAnalystOpinions"),
            "recommendation": g("recommendationKey"),
            "score": g("recommendationMean"),
        },
        "price_history": price_history,
        "recommendations_history": recs_history,
    }


async def get_analyst_report_data(ticker: str, timespan: str) -> dict:
    return await _run(_fetch_analyst_report_data, ticker.upper(), timespan)


def _fetch_price_life(ticker: str) -> dict:
    """Whole-life market data for the document-analysis engine: monthly
    closes since listing, dividends aggregated per year, split history,
    and current market cap. Monthly bars keep even 40-year histories to a
    few hundred points."""
    t = yf.Ticker(ticker)
    out: dict = {"bars": [], "dividends_by_year": [], "splits": [], "market_cap": None}

    try:
        hist = t.history(period="max", interval="1mo", auto_adjust=False)
        if hist is not None and not hist.empty:
            closes = hist["Close"].dropna()
            out["bars"] = [
                {"d": idx.strftime("%Y-%m-%d"), "t": int(idx.timestamp() * 1000),
                 "c": round(float(v), 2)}
                for idx, v in closes.items()
            ]
    except Exception:
        logger.warning("price-life: history failed for %s", ticker)

    try:
        divs = t.dividends
        if divs is not None and not divs.empty:
            per_year: dict[int, float] = {}
            for idx, v in divs.items():
                per_year[idx.year] = per_year.get(idx.year, 0.0) + float(v)
            out["dividends_by_year"] = [
                {"year": y, "value": round(per_year[y], 4)} for y in sorted(per_year)
            ]
    except Exception:
        logger.warning("price-life: dividends failed for %s", ticker)

    try:
        splits = t.splits
        if splits is not None and not splits.empty:
            out["splits"] = [
                {"date": idx.strftime("%Y-%m-%d"),
                 "ratio": f"{v:g}:1" if v == int(v) else f"{v:g}-for-1"}
                for idx, v in splits.items()
            ]
    except Exception:
        logger.warning("price-life: splits failed for %s", ticker)

    try:
        fi = t.fast_info
        mc = fi.market_cap
        if mc:
            out["market_cap"] = float(mc)
    except Exception:
        pass

    return out


async def get_price_life(ticker: str) -> dict:
    return await _run(_fetch_price_life, ticker.upper())


# ── Market Update ──────────────────────────────────────────────────────────

_SECTOR_ETFS = [
    ("XLK",  "Technology"),
    ("XLF",  "Financials"),
    ("XLE",  "Energy"),
    ("XLV",  "Healthcare"),
    ("XLI",  "Industrials"),
    ("XLP",  "Cons. Staples"),
    ("XLY",  "Cons. Disc."),
    ("XLB",  "Materials"),
    ("XLU",  "Utilities"),
    ("XLRE", "Real Estate"),
    ("XLC",  "Comm. Services"),
]

def _download_chunked(tickers, period: str, chunk_size: int = 40):
    """yf.download's wall-clock time scales with ticker count even with
    threads=True (Yahoo's batch endpoint has practical limits). Splitting
    into chunks and downloading them concurrently cuts total time roughly
    by a factor of len(chunks) — but firing every chunk at once trips
    Yahoo's rate limiter, which silently returns NaN columns instead of
    erroring (so failures are invisible unless you count them). Chunks run
    on the shared `_download_pool`, so overlapping callers queue behind the
    same 5 slots rather than each adding 5 more Yahoo connections."""
    import pandas as pd
    chunks = [tickers[i:i + chunk_size] for i in range(0, len(tickers), chunk_size)]
    if len(chunks) == 1:
        return yf.download(tickers, period=period, interval="1d", auto_adjust=True, progress=False, threads=True)

    frames = list(_download_pool.map(
        lambda c: yf.download(c, period=period, interval="1d", auto_adjust=True, progress=False, threads=True),
        chunks,
    ))
    return pd.concat(frames, axis=1)


def _fast_info_price_change(fi) -> tuple[float, float, float] | None:
    """Extract (last_price, previous_close, change_pct) from a yfinance
    fast_info object. Returns None when there's no fresh print (last_price
    missing): falling back to previous_close on both sides would let the
    ticker masquerade as Unchanged 0%, which inflates that breadth bucket.
    Shared between _fetch_quote and the breadth-backfill path so the same
    rounding/edge-case rules apply everywhere."""
    last = fi.last_price
    prev = fi.previous_close
    if not last or not prev:
        return None
    change_pct = (last - prev) / prev * 100
    return float(last), float(prev), float(change_pct)


# Wall-clock budget for the entire backfill pass. We don't try to cancel
# futures that are still running past the budget: cancel() is a no-op for
# already-running ThreadPoolExecutor tasks (verified), and any leftover work
# is tracked in `_in_flight` so the next call doesn't re-submit the same
# ticker on top of it. This keeps the user-visible cold path under BUDGET
# without wasting Yahoo calls or piling up zombie work on the pool.
#
# The budget scales with how much work is actually queued: the old fixed 6s
# was tuned for the 599-stock universe, where a bad throttle event dropped
# tens of tickers. At 2,099 stocks the same event drops hundreds, and a
# fixed 6s pass (≈52 recoveries) could never catch up — breadth and the
# screener silently under-covered until Yahoo behaved again. FLOOR keeps
# small passes snappy (cold user-facing paths); MAX bounds a mass-outage
# pass so a refresh-loop tick can't stall for minutes.
_BACKFILL_BUDGET_FLOOR = 6.0
_BACKFILL_BUDGET_MAX = 30.0
# Rough wall-clock cost of one fast_info call. Used to derive the per-call
# cap from `yf_backfill_size * BUDGET / LATENCY` — submitting many more than
# the pool can plausibly finish inside the budget is wasted Yahoo traffic.
_BACKFILL_LATENCY_S = 0.5


def _backfill_budget(missing_count: int) -> float:
    """Wall-clock budget for one pass, scaled to the queued work."""
    workers = max(1, settings.yf_backfill_size)
    need = missing_count * _BACKFILL_LATENCY_S / workers
    return min(_BACKFILL_BUDGET_MAX, max(_BACKFILL_BUDGET_FLOOR, need))


def _backfill_capacity(budget: float) -> int:
    """Realistic number of tickers one backfill pass can deliver within
    `budget`. The earlier hardcoded 150 cap lied — a 4-worker × 8s budget
    only finishes ~64. Cap and budget must agree or operators read
    misleading logs ("backfilling 150" → only 64 recovered)."""
    workers = max(1, settings.yf_backfill_size)
    return int(workers * (budget / _BACKFILL_LATENCY_S)) + workers


def _fast_info_pair(ticker: str) -> tuple[str, float, float] | None:
    """Per-ticker fallback when the batch download NaN'd a column. Returns
    (ticker, last_price, change_pct) or None when the ticker has no fresh
    quote or fast_info itself errored. Errors are logged (not silently
    swallowed) so a degraded fix mode is visible in the logs."""
    try:
        fi = yf.Ticker(ticker).fast_info
    except Exception as exc:
        logger.debug("fast_info open failed for %s: %s", ticker, exc)
        return None
    try:
        triple = _fast_info_price_change(fi)
    except Exception as exc:
        logger.debug("fast_info read failed for %s: %s", ticker, exc)
        return None
    if triple is None:
        return None
    last, _prev, chg = triple
    return ticker, last, chg


# Tickers that yfinance reports as having no fresh quote are remembered for
# this long before being retried. Only "fast_info returned None" gets marked
# — NOT timeouts or exceptions, because those are Yahoo throttling, not the
# ticker being delisted. Marking timeouts dead poisoned the cache for hours
# after every transient throttle event, hiding the breadth-bar fix it was
# meant to protect. 15 min is short enough for a real outage to self-heal
# but long enough to avoid burning the budget on the same dead names twice.
_DEAD_TICKER_TTL = 15 * 60
# Hard cap so the dict can't grow forever on a long-running server. Pruned
# in-line when we breach this, so the cost is amortised across calls instead
# of needing a separate sweeper task.
_DEAD_TICKERS_MAX = 4000
_dead_tickers: dict[str, float] = {}

# Tracks tickers whose backfill future is still running on `_backfill_pool`
# past the previous call's BUDGET. Without this, the next call would re-
# submit the same ticker, doubling Yahoo traffic for no recovery (the first
# call's future is going to write the same result anyway). The future is
# removed when it completes or when we re-include the ticker on a later
# call (covered by `_prune_in_flight`).
_in_flight: dict[str, Future] = {}
_backfill_state_lock = threading.Lock()


def _prune_dead_tickers(now: float) -> None:
    """Drop expired entries; if the dict is still over `_DEAD_TICKERS_MAX`
    after expiry, drop the oldest half. This is O(N) but amortised — only
    runs when the dict grows past the cap, not every call."""
    with _backfill_state_lock:
        expired = [k for k, ts in _dead_tickers.items() if now - ts >= _DEAD_TICKER_TTL]
        for k in expired:
            _dead_tickers.pop(k, None)
        if len(_dead_tickers) > _DEAD_TICKERS_MAX:
            # Drop the oldest half. Keeps the cache useful for recent names
            # while bounding memory regardless of ticker churn.
            oldest = sorted(_dead_tickers.items(), key=lambda kv: kv[1])
            for k, _ in oldest[: len(_dead_tickers) // 2]:
                _dead_tickers.pop(k, None)


def _prune_in_flight() -> None:
    """Drop futures that already completed so `_in_flight` doesn't grow."""
    with _backfill_state_lock:
        done = [t for t, fut in _in_flight.items() if fut.done()]
        for t in done:
            _in_flight.pop(t, None)


def _backfill_missing(
    tickers,
    have: dict[str, tuple[float, float]],
    *,
    skip_dead: bool = True,
) -> None:
    """Mutates ``have`` (ticker -> (price, change_pct)) by filling in any
    tickers absent from it via per-ticker fast_info calls. Safety net for
    Yahoo's batch endpoint silently NaN-ing columns.

    Behaviour:
    - Bounded by a wall-clock budget scaled to the missing count (see
      ``_backfill_budget``), not per-future timeout (one slow worker would
      block subsequent futures from starting under a per-future timeout).
    - Capped at ``_backfill_capacity(budget)`` tickers per call so the cap
      and the budget agree — submitting more is wasted Yahoo traffic.
    - Tracks in-flight futures across calls in ``_in_flight`` so leftover
      work from a previous budget-exceeded call isn't duplicated.
    - ``skip_dead=False`` is for sector ETFs and other small fixed sets
      that shouldn't share the dead-ticker cache with long-tail stocks
      (a transient miss on XLK would otherwise blank the sector grid for
      ``_DEAD_TICKER_TTL`` minutes)."""
    missing = [t for t in tickers if t not in have]
    if not missing:
        return

    now = time.time()
    if len(_dead_tickers) > _DEAD_TICKERS_MAX:
        _prune_dead_tickers(now)
    _prune_in_flight()

    if skip_dead:
        missing = [
            t for t in missing
            if now - _dead_tickers.get(t, 0) >= _DEAD_TICKER_TTL
        ]
    if not missing:
        return

    # Adopt any in-flight futures from a previous call: don't re-submit.
    futures: dict[Future, str] = {}
    fresh: list[str] = []
    with _backfill_state_lock:
        for t in missing:
            existing = _in_flight.get(t)
            if existing is not None and not existing.done():
                futures[existing] = t
            else:
                fresh.append(t)

    # Cap the *fresh* submissions to realistic capacity (in-flight ones are
    # free — they're already running). Logging the truncation surfaces
    # upstream degradation without making this call longer than the budget.
    budget = _backfill_budget(len(missing))
    capacity = _backfill_capacity(budget)
    if len(fresh) > capacity:
        logger.warning(
            "Yahoo batch dropped %d/%d tickers; backfilling %d this pass "
            "(rest will appear on next refresh).",
            len(missing), len(tickers), capacity,
        )
        fresh = fresh[:capacity]

    # Submit fresh work and record in `_in_flight` atomically so a parallel
    # caller can adopt our futures instead of duplicating them.
    with _backfill_state_lock:
        for t in fresh:
            fut = _backfill_pool.submit(_fast_info_pair, t)
            futures[fut] = t
            _in_flight[t] = fut

    if not futures:
        return

    # `wait()` is the right primitive here: returns done/not_done sets after
    # the budget. We DON'T cancel not_done — cancel() is a no-op for running
    # futures, and `_in_flight` ensures the next call adopts them rather
    # than re-submitting.
    done, not_done = fut_wait(futures, timeout=budget)

    recovered = 0
    for fut in done:
        ticker = futures[fut]
        try:
            result = fut.result(timeout=0)
        except Exception as exc:
            logger.debug("backfill future failed for %s: %s", ticker, exc)
            continue
        finally:
            with _backfill_state_lock:
                _in_flight.pop(ticker, None)
        if result is not None:
            _t, price, chg = result
            have[ticker] = (price, chg)
            recovered += 1
            if skip_dead:
                _dead_tickers.pop(ticker, None)
        elif skip_dead:
            _dead_tickers[ticker] = time.time()

    if missing and recovered == 0:
        logger.warning(
            "Backfill recovered 0/%d missing tickers (%d still running) — "
            "Yahoo likely throttling.",
            len(missing), len(not_done),
        )
    elif len(missing) - recovered > capacity // 2:
        logger.info(
            "Backfill recovered %d/%d missing tickers; %d still running.",
            recovered, len(missing), len(not_done),
        )


def _fetch_market_update() -> dict:
    etf_tickers = [s[0] for s in _SECTOR_ETFS]
    etf_names   = {s[0]: s[1] for s in _SECTOR_ETFS}
    all_tickers = etf_tickers + list(_UNIVERSE)

    raw = _download_chunked(all_tickers, period="2d")
    close = raw["Close"]

    # Collect every ticker we got a valid price+change_pct for. Anything that
    # came back NaN (Yahoo rate-limit silent drop) is filled in below via
    # per-ticker fast_info so the breadth bar counts the full universe.
    have: dict[str, tuple[float, float]] = {}
    if len(close) >= 2:
        last = close.iloc[-1]
        prev = close.iloc[-2]
        for ticker in all_tickers:
            try:
                p  = float(last[ticker])
                pr = float(prev[ticker])
                if p == p and pr == pr and pr > 0:  # NaN check + strictly positive
                    have[ticker] = (p, ((p - pr) / pr * 100))
            except Exception:
                pass

    # Backfill anything the batch endpoint dropped — this is the fix that
    # makes the breadth bar reflect the full universe instead of ~150. Runs even
    # when the batch returned fewer than 2 rows, since that's the case where
    # the safety net matters most.
    #
    # Sector ETFs are backfilled WITHOUT skip_dead because they're a tiny
    # visually-critical fixed set; if XLK temporarily fails fast_info, we
    # don't want it locked out of the sector grid for `_DEAD_TICKER_TTL`.
    # The wider stock universe uses skip_dead so genuine delistings don't
    # waste a fast_info slot every refresh.
    _backfill_missing(etf_tickers, have, skip_dead=False)
    _backfill_missing(_UNIVERSE, have)

    if not have:
        return {"sectors": [], "gainers": [], "losers": [], "breadth": {"advances": 0, "declines": 0, "unchanged": 0, "total": 0}}

    # Sectors (ETF row)
    sectors = []
    for ticker in etf_tickers:
        if ticker in have:
            price, chg = have[ticker]
            sectors.append({
                "ticker":     ticker,
                "name":       etf_names[ticker],
                "price":      round(price, 2),
                "change_pct": round(chg, 2),
            })
    sectors.sort(key=lambda x: x["change_pct"], reverse=True)

    # Gainers / losers across the canonical 2,099-stock universe
    stocks = []
    for ticker in _UNIVERSE:
        if ticker in have:
            price, chg = have[ticker]
            stocks.append({
                "ticker":     ticker,
                "price":      round(price, 2),
                "change_pct": round(chg, 2),
            })
    stocks.sort(key=lambda x: x["change_pct"], reverse=True)

    # Breadth across the canonical universe (not the sector ETFs — those are
    # aggregates of the same names and would double-count). Every stock that
    # has a price contributes exactly once to advances / declines / unchanged,
    # so the three numbers always sum to the visible universe size.
    advances = declines = unchanged = 0
    for ticker in _UNIVERSE:
        if ticker not in have:
            continue
        chg = have[ticker][1]
        if chg > 0:   advances  += 1
        elif chg < 0: declines  += 1
        else:         unchanged += 1

    return {
        "sectors": sectors,
        "gainers": stocks[:10],
        "losers":  list(reversed(stocks[-10:])),
        "breadth": {
            "advances":  advances,
            "declines":  declines,
            "unchanged": unchanged,
            "total":     advances + declines + unchanged,
        },
    }


async def _refresh_market_update_blocking() -> dict:
    """Refresh the market-update cache if stale, blocking until done.

    Single-flight: exactly one fetch runs even if many coroutines call
    concurrently — without the lock each cold caller fired its own
    full-universe batch + backfill in parallel, which deepened Yahoo's
    throttle and ballooned cold-load latency. Used by the background
    refresh loop (so failures propagate into its backoff) and by the
    truly-cold path in get_market_update.
    """
    global _update_cache
    async with _update_lock:
        # Re-check after acquiring — another coroutine may have refreshed
        # while we were queued behind it.
        now = time.time()
        if _update_cache is not None and now - _update_cache[1] < _UPDATE_TTL:
            return _update_cache[0]
        result = await _run(_fetch_market_update)
        _update_cache = (result, time.time())
        return result


async def get_market_update() -> dict:
    """Return the market-update payload.

    Stale-while-revalidate: a full-universe refresh takes ~60s at 2,099
    tickers, so the cache routinely outlives its TTL for a stretch of every
    refresh-loop cycle. Blocking a user request on that refresh made the
    dashboard's market-update section hang past the frontend's patience.
    A stale payload is served immediately and one background refresh
    (single-flighted by _update_lock) brings it current; only a completely
    cold cache — the first request after boot, before the warm-up loop
    fills it — blocks on the fetch.
    """
    if _update_cache is not None:
        if time.time() - _update_cache[1] < _UPDATE_TTL:
            return _update_cache[0]
        if not _update_lock.locked():
            async def _bg() -> None:
                try:
                    await _refresh_market_update_blocking()
                except Exception as exc:
                    logger.debug("SWR market-update refresh failed: %s", exc)
            asyncio.create_task(_bg())
        return _update_cache[0]
    return await _refresh_market_update_blocking()



# ── Stock Screener ─────────────────────────────────────────────────────────

# The screener shows the same 2,099 stocks tracked by breadth and gainers/losers.
_SCREENER_UNIVERSE = _UNIVERSE

_screener_data: list = []
_screener_ts: float = 0.0
_screener_fetching: bool = False   # sentinel: True while a fetch is in progress
_screener_lock = threading.Lock()
_SCREENER_TTL = 1800  # 30 minutes


def _volume_level(volume: float | None, avg_volume: float | None) -> str:
    """Bucket today's volume relative to the stock's own average — a flat
    threshold would call every small-cap "Low" and every mega-cap "High"."""
    if not volume or not avg_volume:
        return "Average"
    ratio = volume / avg_volume
    if ratio < 0.5:  return "Low"
    if ratio < 1.5:  return "Average"
    if ratio < 3.0:  return "High"
    return "Very High"


def _bounded_info(ticker: str, timeout: float = 3.0) -> dict:
    """yf.Ticker(ticker).info, bounded so a single slow ticker can't stall
    the whole screener/funds batch past the time budget. Uses the shared
    `_info_pool` so we don't create+shutdown a ThreadPoolExecutor per
    ticker — that pattern also defeated the timeout via shutdown(wait=True)."""
    return _info_with_timeout(ticker, timeout)


# Company metadata (name/sector/industry/52-week stats/PE/dividend rate)
# changes slowly, but the screener was re-pulling full `.info` — Yahoo's
# heaviest endpoint — for all 2,099 tickers on every ~29-min refresh. Cache
# the .info-derived fields per ticker for 6h and refresh only price/change
# each cycle. Bounded by the universe size, so no LRU machinery needed.
# Volume (and its Low/Average/High bucket) rides along with the metadata,
# so it can be up to 6h old — acceptable for a coarse screener column.
_SCREENER_INFO_TTL = 6 * 3600
_screener_info_cache: dict[str, tuple[dict, float]] = {}


def _screener_row(ticker: str, price: float, change_pct: float) -> dict | None:
    """Build one screener row: fresh price/change from the caller, slow
    metadata from the 6h cache. Single shared implementation for the batch
    screener (_fetch_screener_inner) and the streaming screener."""
    try:
        now = time.time()
        entry = _screener_info_cache.get(ticker)
        if entry is not None and now - entry[1] < _SCREENER_INFO_TTL:
            meta = entry[0]
        else:
            info = _bounded_info(ticker)
            raw_52 = info.get("52WeekChange")
            pe = info.get("trailingPE")
            volume = info.get("volume") or info.get("regularMarketVolume")
            meta = {
                "name":           info.get("longName") or info.get("shortName", ticker),
                "sector":         info.get("sector")   or "Other",
                "industry":       info.get("industry") or "",
                "week_52_return": round(raw_52 * 100, 2) if raw_52 is not None else None,
                "week_52_high":   round(info.get("fiftyTwoWeekHigh") or 0, 2) or None,
                "week_52_low":    round(info.get("fiftyTwoWeekLow")  or 0, 2) or None,
                "market_cap":     info.get("marketCap") or 0,
                "pe_ratio":       round(pe, 2) if pe is not None else None,
                "dividend_rate":  info.get("dividendRate") or 0,
                "volume":         volume,
                "volume_level":   _volume_level(volume, info.get("averageVolume")),
                "country":        info.get("country") or "United States",
            }
            # Don't cache a timed-out/empty .info — that would pin blank
            # metadata for 6h after one transient throttle event.
            if info:
                _screener_info_cache[ticker] = (meta, now)
        div_rate = meta["dividend_rate"]
        row = {k: v for k, v in meta.items() if k != "dividend_rate"}
        row["ticker"] = ticker
        row["price"] = round(price, 2)
        row["change_pct"] = round(change_pct, 2)
        row["dividend_yield"] = round(
            (div_rate / price * 100) if price > 0 and div_rate > 0 else 0.0, 4
        )
        return row
    except Exception:
        return None


def _fetch_screener() -> list[dict]:
    global _screener_data, _screener_ts, _screener_fetching

    now = time.time()
    with _screener_lock:
        if _screener_data and (now - _screener_ts) < _SCREENER_TTL:
            return _screener_data
        # If another thread/coroutine is already fetching, return the stale
        # cache immediately rather than launching a duplicate fetch.
        if _screener_fetching:
            return _screener_data
        _screener_fetching = True

    # Everything past the sentinel claim must run under try/finally — if any
    # call below raises (yfinance can throw on network errors, pandas can on
    # malformed responses), we MUST clear _screener_fetching or every future
    # request returns the cold empty cache for the lifetime of the process.
    try:
        return _fetch_screener_inner()
    finally:
        with _screener_lock:
            _screener_fetching = False


def _fetch_screener_inner() -> list[dict]:
    global _screener_data, _screener_ts
    tickers = _SCREENER_UNIVERSE

    raw = _download_chunked(tickers, "5d")
    close = raw["Close"]

    have: dict[str, tuple[float, float]] = {}
    if len(close) >= 2:
        last = close.iloc[-1]
        prev = close.iloc[-2]
        for t in tickers:
            try:
                p  = float(last[t])
                pr = float(prev[t])
                if p == p and pr == pr and pr > 0:
                    have[t] = (p, ((p - pr) / pr * 100))
            except Exception:
                pass

    # Same NaN-drop problem breadth/gainers hit: Yahoo's batch endpoint can
    # silently drop columns for a chunk. Backfill via fast_info so the
    # screener covers the full canonical universe, same as breadth/gainers.
    _backfill_missing(tickers, have)
    price_map: dict[str, dict] = {
        t: {"price": p, "change_pct": chg} for t, (p, chg) in have.items()
    }

    def fetch_info(ticker: str) -> dict | None:
        pd_ = price_map.get(ticker, {})
        return _screener_row(ticker, pd_.get("price", 0), pd_.get("change_pct", 0))

    results: list[dict] = []
    batch_size = 40
    for i in range(0, len(tickers), batch_size):
        batch = tickers[i:i + batch_size]
        futs = {_screener_batch_pool.submit(fetch_info, t): t for t in batch}
        for fut in as_completed(futs):
            r = fut.result()
            if r:
                results.append(r)
        # Publish a partial snapshot so concurrent requests — which land on
        # the stale-cache path while _screener_fetching is claimed — see a
        # growing list instead of an empty screener for the whole cold
        # fetch (minutes at 2,099 tickers). Only when it beats what's
        # cached: a stale-but-complete list outranks a partial one, so warm
        # refreshes keep serving the old data until this fetch finishes.
        # _screener_ts stays untouched, so the partial still counts as
        # stale and never suppresses the completion write below.
        if results:
            partial = sorted(results, key=lambda x: x["market_cap"], reverse=True)
            with _screener_lock:
                if len(partial) > len(_screener_data):
                    _screener_data = partial
        if i + batch_size < len(tickers):
            time.sleep(1.0)

    results.sort(key=lambda x: x["market_cap"], reverse=True)
    with _screener_lock:
        _screener_data = results
        _screener_ts   = time.time()  # record actual completion time
    return results


# ── Portfolio Analytics ────────────────────────────────────────────────────

def _fetch_portfolio_item(ticker: str, shares: float, avg_buy_price: float) -> dict:
    try:
        t = yf.Ticker(ticker)
        fi = t.fast_info
        info = t.info
        price = fi.last_price or fi.previous_close or avg_buy_price
        cost = shares * avg_buy_price
        value = shares * price
        pnl = value - cost
        div_rate = info.get("dividendRate") or 0
        div_yield = (div_rate / price * 100) if price > 0 and div_rate > 0 else 0.0
        annual_div_per_share = round(div_rate, 4)
        annual_div_income = round(div_rate * shares, 2)
        beta = info.get("beta")
        return {
            "ticker":         ticker,
            "name":           info.get("longName") or info.get("shortName", ticker),
            "sector":         info.get("sector")   or "Other",
            "industry":       info.get("industry") or "",
            "shares":         shares,
            "avg_buy_price":  round(avg_buy_price, 2),
            "current_price":  round(price, 2),
            "cost":           round(cost, 2),
            "value":          round(value, 2),
            "pnl":            round(pnl, 2),
            "pnl_pct":        round(pnl / cost * 100, 2) if cost > 0 else 0,
            "dividend_yield": round(div_yield, 4),
            "annual_dividend_per_share": annual_div_per_share,
            "annual_dividend_income":    annual_div_income,
            "beta":           round(beta, 3) if isinstance(beta, (int, float)) else None,
            "allocation_pct": 0,  # filled by the router after aggregation
        }
    except Exception as exc:
        # The fallback row (price = cost basis, P&L 0) keeps the portfolio
        # rendering, but silently swallowing the cause made data corruption
        # undiagnosable — every totals/allocation/health number quietly
        # absorbed the fake value. Log loudly.
        logger.warning("portfolio item fetch failed for %s — serving cost-basis fallback: %s", ticker, exc)
        cost = shares * avg_buy_price
        return {
            "ticker": ticker, "name": ticker, "sector": "Other", "industry": "",
            "shares": shares, "avg_buy_price": round(avg_buy_price, 2),
            "current_price": round(avg_buy_price, 2),
            "cost": round(cost, 2), "value": round(cost, 2),
            "pnl": 0, "pnl_pct": 0, "dividend_yield": 0,
            "annual_dividend_per_share": 0, "annual_dividend_income": 0,
            "beta": None,
            "allocation_pct": 0,
        }


async def get_portfolio_analytics(items: list[dict]) -> list[dict]:
    tasks = [
        _run(_fetch_portfolio_item, item["ticker"], item["shares"], item["avg_buy_price"])
        for item in items
    ]
    results = await asyncio.gather(*tasks)
    return [r for r in results if r is not None]


async def get_benchmark_history(start_date: str, end_date: str) -> list[dict]:
    """Get SPY daily close prices for the given date range."""
    def _fetch():
        spy = yf.Ticker("SPY")
        hist = spy.history(start=start_date, end=end_date)
        return [{"date": d.strftime("%Y-%m-%d"), "close": round(row["Close"], 2)}
                for d, row in hist.iterrows()]
    return await _run(_fetch)


async def get_screener() -> list[dict]:
    return await _run(_fetch_screener)


# ── Background refresh loops ──────────────────────────────────────────────
# These are the cure for "more users → more yfinance load → more throttling →
# more errors". Without them every cache miss was paid by a real user request,
# so user-visible cold-load latency scaled with traffic spikes and every TTL
# expiry triggered a thundering herd of full-universe batch fetches that
# deepened Yahoo's throttle. With them, exactly one refresher per process
# talks to yfinance on a fixed schedule and every user request returns from
# memory.

# Refresh slightly ahead of the TTL so the cache never goes stale under
# normal conditions. Floors keep the refresher from hammering Yahoo if
# someone sets the TTL to a tiny value.
# The update refresh itself takes ~60s at 2,099 tickers and the loop sleeps
# AFTER the fetch completes, so the margin must absorb the fetch duration or
# the cache spends part of every cycle past its TTL.
_UPDATE_REFRESH_INTERVAL   = max(60,  _UPDATE_TTL   - 90)
_SCREENER_REFRESH_INTERVAL = max(300, _SCREENER_TTL - 60)


# Resilience knobs for the refresh loops:
#   _REFRESH_JITTER  — fraction of the interval added/subtracted at random
#                      so multiple replicas don't sync their Yahoo hits.
#   _BACKOFF_BASE/_CAP — exponential backoff on repeated failures so a Yahoo
#                      outage doesn't pin us at the full refresh cadence.
_REFRESH_JITTER  = 0.15
_BACKOFF_BASE    = 30.0    # seconds — first backoff after one failure
_BACKOFF_CAP     = 600.0   # seconds — max backoff (10 min)


def _jittered_sleep(interval: float, *, jitter: float = _REFRESH_JITTER) -> float:
    """Add ±jitter so concurrent replicas/processes spread their requests."""
    if jitter <= 0:
        return interval
    return interval * (1.0 + random.uniform(-jitter, jitter))


async def _refresh_loop(
    name: str,
    interval: float,
    refresh_fn: Callable[[], Awaitable[Any]],
) -> None:
    """Shared cache-warmer loop with jitter and exponential backoff.

    Single error → retry on next jittered tick. Repeated errors → exponential
    backoff up to _BACKOFF_CAP so a Yahoo outage doesn't deepen the throttle
    by hammering at full cadence. Backoff resets the moment a refresh
    succeeds, so we return to the normal cadence as soon as upstream recovers.
    """
    logger.info("%s auto-refresh loop started (every ~%ds).", name, int(interval))
    failures = 0
    while True:
        try:
            await refresh_fn()
            failures = 0
        except Exception as exc:
            failures += 1
            logger.warning("periodic %s refresh failed (#%d): %s", name, failures, exc)

        if failures == 0:
            sleep_s = _jittered_sleep(interval)
        else:
            backoff = min(_BACKOFF_BASE * (2 ** (failures - 1)), _BACKOFF_CAP)
            sleep_s = _jittered_sleep(backoff)
            logger.info(
                "%s loop: backing off %.1fs after %d consecutive failures.",
                name, sleep_s, failures,
            )
        await asyncio.sleep(sleep_s)


async def refresh_market_update_loop() -> None:
    """Keep the /market/update cache continuously warm so user requests
    always hit memory instead of yfinance. Uses the blocking refresher so
    a failed fetch raises into _refresh_loop's backoff instead of being
    swallowed by get_market_update's serve-stale path."""
    await _refresh_loop(
        "market-update", _UPDATE_REFRESH_INTERVAL, _refresh_market_update_blocking
    )


async def refresh_screener_loop() -> None:
    """Keep the /screener cache continuously warm. Same rationale as
    refresh_market_update_loop — decouples upstream load from user traffic."""
    await _refresh_loop("screener", _SCREENER_REFRESH_INTERVAL, get_screener)


# ── Earnings Calendar ─────────────────────────────────────────────────────

_earnings_cache: dict[int, tuple[dict, float]] = {}
_EARNINGS_TTL = 3600  # 1 hour — earnings dates don't change often

SAMPLE_EARNINGS = [
    {"ticker": "AAPL", "name": "Apple Inc.", "time": "AMC", "eps_estimate": 1.58, "eps_actual_prev": 1.53, "beat_history": "3/4"},
    {"ticker": "MSFT", "name": "Microsoft Corp.", "time": "AMC", "eps_estimate": 3.10, "eps_actual_prev": 2.94, "beat_history": "4/4"},
    {"ticker": "GOOGL", "name": "Alphabet Inc.", "time": "AMC", "eps_estimate": 1.89, "eps_actual_prev": 1.91, "beat_history": "3/4"},
    {"ticker": "AMZN", "name": "Amazon.com Inc.", "time": "AMC", "eps_estimate": 1.14, "eps_actual_prev": 1.00, "beat_history": "4/4"},
    {"ticker": "META", "name": "Meta Platforms Inc.", "time": "AMC", "eps_estimate": 5.25, "eps_actual_prev": 4.71, "beat_history": "4/4"},
    {"ticker": "NVDA", "name": "NVIDIA Corp.", "time": "AMC", "eps_estimate": 0.82, "eps_actual_prev": 0.68, "beat_history": "4/4"},
    {"ticker": "TSLA", "name": "Tesla Inc.", "time": "AMC", "eps_estimate": 0.73, "eps_actual_prev": 0.71, "beat_history": "2/4"},
    {"ticker": "JPM", "name": "JPMorgan Chase", "time": "BMO", "eps_estimate": 4.62, "eps_actual_prev": 4.44, "beat_history": "4/4"},
    {"ticker": "V", "name": "Visa Inc.", "time": "AMC", "eps_estimate": 2.41, "eps_actual_prev": 2.29, "beat_history": "4/4"},
    {"ticker": "JNJ", "name": "Johnson & Johnson", "time": "BMO", "eps_estimate": 2.65, "eps_actual_prev": 2.71, "beat_history": "3/4"},
    {"ticker": "WMT", "name": "Walmart Inc.", "time": "BMO", "eps_estimate": 0.65, "eps_actual_prev": 0.60, "beat_history": "4/4"},
    {"ticker": "PG", "name": "Procter & Gamble", "time": "BMO", "eps_estimate": 1.72, "eps_actual_prev": 1.68, "beat_history": "3/4"},
    {"ticker": "UNH", "name": "UnitedHealth Group", "time": "BMO", "eps_estimate": 6.72, "eps_actual_prev": 6.91, "beat_history": "4/4"},
    {"ticker": "HD", "name": "Home Depot", "time": "BMO", "eps_estimate": 4.54, "eps_actual_prev": 4.65, "beat_history": "3/4"},
    {"ticker": "BAC", "name": "Bank of America", "time": "BMO", "eps_estimate": 0.83, "eps_actual_prev": 0.90, "beat_history": "3/4"},
    {"ticker": "DIS", "name": "Walt Disney Co.", "time": "AMC", "eps_estimate": 1.20, "eps_actual_prev": 1.21, "beat_history": "3/4"},
    {"ticker": "NFLX", "name": "Netflix Inc.", "time": "AMC", "eps_estimate": 4.54, "eps_actual_prev": 5.28, "beat_history": "4/4"},
    {"ticker": "CRM", "name": "Salesforce Inc.", "time": "AMC", "eps_estimate": 2.43, "eps_actual_prev": 2.11, "beat_history": "4/4"},
    {"ticker": "COST", "name": "Costco Wholesale", "time": "AMC", "eps_estimate": 3.69, "eps_actual_prev": 3.92, "beat_history": "3/4"},
    {"ticker": "INTC", "name": "Intel Corp.", "time": "AMC", "eps_estimate": 0.13, "eps_actual_prev": 0.17, "beat_history": "2/4"},
]


def _generate_earnings_calendar(week_offset: int) -> dict:
    """Generate earnings calendar data for a given week."""
    import hashlib

    today = date.today()
    monday = today - timedelta(days=today.weekday()) + timedelta(weeks=week_offset)
    friday = monday + timedelta(days=4)

    days = {}
    for day_offset in range(5):
        current_date = monday + timedelta(days=day_offset)
        day_name = current_date.strftime("%A")
        day_str = current_date.strftime("%Y-%m-%d")

        day_companies = []
        for comp in SAMPLE_EARNINGS:
            h = hashlib.md5(f"{comp['ticker']}{week_offset}{day_offset}".encode()).hexdigest()
            if int(h[:2], 16) < 50:  # ~20% chance per company per day
                day_companies.append(comp)

        days[day_name] = {
            "date": day_str,
            "day": day_name,
            "companies": day_companies[:4],
        }

    return {
        "week_start": str(monday),
        "week_end": str(friday),
        "days": days,
    }


async def get_earnings_calendar(week_offset: int = 0) -> dict:
    now = time.time()
    if week_offset in _earnings_cache:
        data, ts = _earnings_cache[week_offset]
        if now - ts < _EARNINGS_TTL:
            return data
    result = _generate_earnings_calendar(week_offset)
    _earnings_cache[week_offset] = (result, now)
    return result


# ── Economic Calendar ───────────────────────────────────────────────────────
# No live economic-calendar API is wired up yet (Trading Economics / FMP both
# require a paid key). This mirrors the existing earnings-calendar approach —
# a curated template of real, recurring US macro releases placed on the
# calendar using their actual real-world cadence (NFP = first Friday of the
# month, jobless claims = every Thursday, etc.) rather than random placement.
# Swap in a live provider here once a key is available; the response shape
# is the contract callers depend on.

_ECONOMIC_EVENTS = [
    {"name": "Federal Reserve Interest Rate Decision", "category": "Fed Events",   "impact": "High",   "weekday": 2, "unit": "%",         "base": 4.25, "vol": 0.0,  "cadence": "fomc"},
    {"name": "FOMC Meeting Minutes",                    "category": "Fed Events",   "impact": "Medium", "weekday": 2, "unit": "",          "base": 0,    "vol": 0,    "cadence": "fomc_minutes"},
    {"name": "Nonfarm Payrolls",                        "category": "Jobs & Labor", "impact": "High",   "weekday": 4, "unit": "K",         "base": 180,  "vol": 60,   "cadence": "first_friday"},
    {"name": "Unemployment Rate",                       "category": "Jobs & Labor", "impact": "High",   "weekday": 4, "unit": "%",         "base": 4.1,  "vol": 0.2,  "cadence": "first_friday"},
    {"name": "Initial Jobless Claims",                  "category": "Jobs & Labor", "impact": "Medium", "weekday": 3, "unit": "K",         "base": 220,  "vol": 15,   "cadence": "weekly"},
    {"name": "Consumer Price Index (CPI)",              "category": "Inflation",    "impact": "High",   "weekday": 1, "unit": "% MoM",     "base": 0.3,  "vol": 0.15, "cadence": "mid_month"},
    {"name": "Producer Price Index (PPI)",              "category": "Inflation",    "impact": "Medium", "weekday": 3, "unit": "% MoM",     "base": 0.2,  "vol": 0.15, "cadence": "mid_month_late"},
    {"name": "Core PCE Price Index",                    "category": "Inflation",    "impact": "High",   "weekday": 4, "unit": "% MoM",     "base": 0.25, "vol": 0.1,  "cadence": "last_friday"},
    {"name": "GDP Growth Rate (Advance Estimate)",      "category": "GDP",          "impact": "High",   "weekday": 3, "unit": "% QoQ ann.","base": 2.2,  "vol": 0.7,  "cadence": "gdp_quarter"},
    {"name": "Retail Sales",                            "category": "Other",        "impact": "Medium", "weekday": 2, "unit": "% MoM",     "base": 0.4,  "vol": 0.3,  "cadence": "mid_month"},
    {"name": "ISM Manufacturing PMI",                   "category": "Other",        "impact": "Medium", "weekday": 0, "unit": "",          "base": 49.0, "vol": 1.5,  "cadence": "first_friday_week"},
    {"name": "Consumer Confidence Index",               "category": "Other",        "impact": "Low",    "weekday": 1, "unit": "",          "base": 105,  "vol": 4,    "cadence": "last_week"},
    {"name": "Big Bank Earnings Season Begins",         "category": "Earnings Season Dates", "impact": "Medium", "weekday": 1, "unit": "", "base": 0, "vol": 0, "cadence": "earnings_season"},
]

_FOMC_ANCHOR = date(2024, 1, 1)  # arbitrary Monday-aligned reference for the ~6-week FOMC cadence


def _nth_weekday_of_month(year: int, month: int, weekday: int, last: bool = False) -> date:
    import calendar as _cal
    if last:
        last_day = _cal.monthrange(year, month)[1]
        d = date(year, month, last_day)
        return d - timedelta(days=(d.weekday() - weekday) % 7)
    d = date(year, month, 1)
    return d + timedelta(days=(weekday - d.weekday()) % 7)


def _week_contains(monday: date, target: date) -> bool:
    return monday <= target <= monday + timedelta(days=4)


def _is_fomc_week(monday: date) -> bool:
    weeks_since_anchor = (monday - _FOMC_ANCHOR).days // 7
    return weeks_since_anchor % 6 == 0


def _event_date_for_week(ev: dict, monday: date) -> date | None:
    cadence = ev["cadence"]
    weekday = ev["weekday"]
    candidate = monday + timedelta(days=weekday)

    # Use the candidate date's own month, not monday's — a Mon-Fri week can
    # straddle a month boundary, and "first Friday of the month" must resolve
    # against whichever month that Friday actually falls in.
    if cadence == "weekly":
        return candidate
    if cadence == "first_friday":
        target = _nth_weekday_of_month(candidate.year, candidate.month, weekday)
        return candidate if _week_contains(monday, target) else None
    if cadence == "first_friday_week":
        # Same week as the month's first Friday, but on this event's own weekday.
        first_friday = _nth_weekday_of_month(candidate.year, candidate.month, 4)
        return candidate if _week_contains(monday, first_friday) else None
    if cadence == "last_friday":
        target = _nth_weekday_of_month(candidate.year, candidate.month, 4, last=True)
        return candidate if _week_contains(monday, target) else None
    if cadence == "last_week":
        last_day_of_month = date(monday.year, monday.month, 1) + timedelta(days=31)
        last_day_of_month = last_day_of_month.replace(day=1) - timedelta(days=1)
        return candidate if last_day_of_month - candidate < timedelta(days=7) and candidate.month == monday.month else None
    if cadence == "mid_month":
        return candidate if 8 <= candidate.day <= 14 else None
    if cadence == "mid_month_late":
        return candidate if 12 <= candidate.day <= 18 else None
    if cadence == "gdp_quarter":
        if candidate.month not in (1, 4, 7, 10):
            return None
        target = _nth_weekday_of_month(candidate.year, candidate.month, weekday, last=True)
        return candidate if _week_contains(monday, target) else None
    if cadence == "fomc":
        return candidate if _is_fomc_week(monday) else None
    if cadence == "fomc_minutes":
        three_weeks_ago = monday - timedelta(weeks=3)
        return candidate if _is_fomc_week(three_weeks_ago) else None
    if cadence == "earnings_season":
        return candidate if candidate.month in (1, 4, 7, 10) and 8 <= candidate.day <= 14 else None
    return None


def _generate_economic_calendar(week_offset: int) -> dict:
    import hashlib

    today = date.today()
    monday = today - timedelta(days=today.weekday()) + timedelta(weeks=week_offset)
    friday = monday + timedelta(days=4)

    events = []
    for ev in _ECONOMIC_EVENTS:
        event_date = _event_date_for_week(ev, monday)
        if event_date is None:
            continue

        h = hashlib.md5(f"{ev['name']}{event_date.isoformat()}".encode()).hexdigest()
        # Deterministic pseudo-random offset within +/- vol, derived from the hash.
        frac = (int(h[:8], 16) % 2000 - 1000) / 1000  # -1.0 .. 1.0
        forecast = round(ev["base"] + frac * ev["vol"], 2) if ev["vol"] else ev["base"]
        # "Previous" reading is the forecast for the prior occurrence — close
        # to forecast but not identical, using a different hash slice.
        frac2 = (int(h[8:16], 16) % 2000 - 1000) / 1000
        previous = round(ev["base"] + frac2 * ev["vol"], 2) if ev["vol"] else ev["base"]
        actual = None
        if event_date <= today:
            frac3 = (int(h[16:24], 16) % 2000 - 1000) / 1000
            actual = round(forecast + frac3 * ev["vol"] * 0.5, 2) if ev["vol"] else ev["base"]

        events.append({
            "name": ev["name"],
            "category": ev["category"],
            "impact": ev["impact"],
            "date": event_date.isoformat(),
            "day": event_date.strftime("%A"),
            "time_et": "08:30 ET" if ev["weekday"] != 2 or ev["category"] != "Fed Events" else "14:00 ET",
            "country": "United States",
            "previous": f"{previous}{ev['unit']}" if ev["unit"] or previous else None,
            "forecast": f"{forecast}{ev['unit']}" if ev["unit"] or forecast else None,
            "actual": f"{actual}{ev['unit']}" if actual is not None else None,
        })

    events.sort(key=lambda e: (e["date"], {"High": 0, "Medium": 1, "Low": 2}[e["impact"]]))

    return {
        "week_start": str(monday),
        "week_end": str(friday),
        "events": events,
    }


_econ_calendar_cache: dict[int, tuple[dict, float]] = {}
_ECON_CALENDAR_TTL = 3600  # 1 hour


async def get_economic_calendar(week_offset: int = 0) -> dict:
    now = time.time()
    if week_offset in _econ_calendar_cache:
        data, ts = _econ_calendar_cache[week_offset]
        if now - ts < _ECON_CALENDAR_TTL:
            return data
    result = _generate_economic_calendar(week_offset)
    _econ_calendar_cache[week_offset] = (result, now)
    return result


async def stream_screener():
    """Async generator — yields one stock dict at a time as .info calls finish.

    Cache hit  : all stocks yielded immediately (< 100 ms).
    Cache miss : each stock yielded as soon as its yfinance call completes,
                 so the first rows appear within ~1-2 s instead of ~10 s.

    Backfill runs as a fire-and-forget background task that mutates `have`
    while the info-fetch loop runs in parallel. Rows processed before
    backfill catches them get the default (price 0, change 0) — same as
    pre-backfill behaviour. This preserves the streaming latency contract
    above; the previous design that awaited backfill blocked the first
    yield for the entire backfill budget (~6-8 s).

    Stampede guard: if _fetch_screener (called via get_screener) is already
    fetching, serve the stale cache immediately rather than launching a second
    parallel fetch. The _screener_fetching sentinel is the shared signal.
    """
    global _screener_data, _screener_ts, _screener_fetching
    # Move the lock check off the event loop onto a thread to avoid blocking
    # the loop if the threading.Lock is briefly contended.
    loop = asyncio.get_running_loop()

    def _check_cache():
        # Must declare global here: assigning _screener_fetching = True below
        # would otherwise make Python treat it as a local variable in this nested
        # function, causing UnboundLocalError when we read it first.
        global _screener_fetching
        now = time.time()
        with _screener_lock:
            if _screener_data and (now - _screener_ts) < _SCREENER_TTL:
                return "hit", list(_screener_data)
            if _screener_fetching:
                # Another fetch is in progress — return stale data to this caller.
                return "stale", list(_screener_data)
            # Claim the fetch slot.
            _screener_fetching = True
            return "miss", []

    status, cached = await loop.run_in_executor(_pool, _check_cache)

    if status in ("hit", "stale"):
        for stock in cached:
            yield stock
        return

    tickers = _SCREENER_UNIVERSE
    loop = asyncio.get_running_loop()

    raw = await loop.run_in_executor(_pool, lambda: _download_chunked(tickers, "5d"))
    close = raw["Close"]
    have: dict[str, tuple[float, float]] = {}
    if len(close) >= 2:
        last, prev = close.iloc[-1], close.iloc[-2]
        for t in tickers:
            try:
                p, pr = float(last[t]), float(prev[t])
                if p == p and pr == pr and pr > 0:
                    have[t] = (p, ((p - pr) / pr * 100))
            except Exception:
                pass

    # Kick off backfill in the background — don't await. `have` is mutated by
    # the backfill worker; `_fetch_one` reads it at call time. Per-item GIL
    # atomicity makes the concurrent dict access safe (we only read/write
    # whole tuples, never iterate during a write).
    backfill_task = asyncio.create_task(
        loop.run_in_executor(_pool, lambda: _backfill_missing(tickers, have))
    )

    queue: asyncio.Queue[dict | None] = asyncio.Queue()
    batch_size = 40
    total_expected = len(tickers)

    def _fetch_one(ticker: str) -> None:
        pd_ = have.get(ticker)
        item = _screener_row(ticker, pd_[0] if pd_ else 0.0, pd_[1] if pd_ else 0.0)
        # item is None on failure — the consumer loop skips None entries.
        loop.call_soon_threadsafe(queue.put_nowait, item)

    def _process_batches():
        # Limit in-flight .info calls per batch — the shared 6-worker
        # `_screener_batch_pool` throttles below Yahoo's "Invalid Crumb"
        # rate limit and is the same budget _fetch_screener_inner uses.
        for i in range(0, len(tickers), batch_size):
            batch = tickers[i:i + batch_size]
            list(_screener_batch_pool.map(_fetch_one, batch))
            if i + batch_size < len(tickers):
                time.sleep(1.0)

    loop.run_in_executor(None, _process_batches)

    collected: list[dict] = []
    try:
        for _ in range(total_expected):
            item = await asyncio.wait_for(queue.get(), timeout=120)
            if item is not None:
                collected.append(item)
                yield item
                # Same progressive publish as _fetch_screener_inner: give
                # concurrent stale-path requests partial rows during a cold
                # stream instead of an empty screener.
                if len(collected) % 40 == 0:
                    partial = sorted(collected, key=lambda x: x["market_cap"], reverse=True)
                    with _screener_lock:
                        if len(partial) > len(_screener_data):
                            _screener_data = partial
    except asyncio.TimeoutError:
        pass
    finally:
        # Always release the sentinel — even if the generator is closed early
        # (client disconnects, exception mid-stream) so future requests don't
        # get permanently stuck in "fetching" mode and return empty results.
        collected.sort(key=lambda x: x["market_cap"], reverse=True)
        with _screener_lock:
            if collected:  # only overwrite cache if we got something useful
                _screener_data = collected
                _screener_ts   = time.time()
            _screener_fetching = False
        # Tidy the backfill task so asyncio doesn't warn about a destroyed
        # pending task when the generator is GC'd early (client disconnect).
        # `_in_flight` tracking inside _backfill_missing means any in-progress
        # work on the pool still completes and isn't double-submitted next call.
        if not backfill_task.done():
            backfill_task.cancel()
