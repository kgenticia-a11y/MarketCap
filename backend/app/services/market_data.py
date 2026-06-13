"""
Data service backed entirely by yfinance + Yahoo Finance APIs.
No API key required.
yfinance is synchronous, so every call runs in a thread-pool executor.
"""
import asyncio
import certifi
import threading
import time
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta, date

import httpx
import yfinance as yf

from app.config import settings

# Thread pool size configurable via YF_POOL_SIZE; default 6.
_pool = ThreadPoolExecutor(max_workers=settings.yf_pool_size)


async def _run(fn, *args, **kwargs):
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(_pool, lambda: fn(*args, **kwargs))


# ── Generic TTL cache helpers ──────────────────────────────────────────────
# Each cache is a plain dict: key → (value, timestamp).
# CPython's GIL makes individual dict reads/writes atomic, so these are safe
# for concurrent asyncio coroutines without an explicit lock.  The worst-case
# is a brief stampede where two coroutines both miss the cache; the second
# result simply overwrites the first, which is harmless.

_quote_cache:   dict[str, tuple[dict, float]] = {}
_details_cache: dict[str, tuple[dict, float]] = {}
_news_cache:    dict[str, tuple[dict, float]] = {}
_chart_cache:   dict[str, tuple[dict, float]] = {}
_update_cache:  tuple[dict, float] | None = None
_funds_cache:   dict[str, tuple[list, float]] = {}

_QUOTE_TTL   =  30   # seconds — price data refreshes frequently
_DETAILS_TTL = 300   # 5 min  — company fundamentals rarely change intraday
_NEWS_TTL    = 300   # 5 min  — news feed doesn't need per-second freshness
_CHART_1D_TTL  =  60   # 1 min  — intraday candles need to be fairly fresh
_CHART_TTL     = 300   # 5 min  — daily/weekly/monthly candles
_UPDATE_TTL  = 300   # 5 min  — market-update sector/breadth data
_FUNDS_TTL   = 600   # 10 min — fund data changes slowly


# ── Quote ──────────────────────────────────────────────────────────────────

def _fetch_quote(ticker: str) -> dict:
    t = yf.Ticker(ticker)
    try:
        fi = t.fast_info
        price = fi.last_price or fi.previous_close or 0
    except KeyError:
        raise ValueError(f"Ticker '{ticker}' not found")
    if not price:
        raise ValueError(f"Ticker '{ticker}' not found")
    prev = fi.previous_close or price
    change_pct = ((price - prev) / prev * 100) if prev else 0
    return {
        "ticker": ticker.upper(),
        "price": round(price, 4),
        "open": round(fi.open or 0, 4),
        "high": round(fi.day_high or 0, 4),
        "low": round(fi.day_low or 0, 4),
        "volume": int(fi.last_volume or 0),
        "change_pct": round(change_pct, 4),
    }


async def get_quote(ticker: str) -> dict:
    """Return a full quote dict: price, previous close, change %, volume, etc."""
    t = ticker.upper()
    now = time.time()
    if t in _quote_cache:
        data, ts = _quote_cache[t]
        if now - ts < _QUOTE_TTL:
            return data
    result = await _run(_fetch_quote, t)
    _quote_cache[t] = (result, now)
    return result


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


async def get_aggregates(ticker: str, multiplier: int, timespan: str, from_date: str, to_date: str) -> dict:
    t = ticker.upper()
    cache_key = f"{t}:{timespan}:{multiplier}:{from_date}"
    ttl = _CHART_1D_TTL if timespan == "minute" else _CHART_TTL
    now = time.time()
    if cache_key in _chart_cache:
        data, ts = _chart_cache[cache_key]
        if now - ts < ttl:
            return data
    result = await _run(_fetch_chart, t, multiplier, timespan, from_date, to_date)
    _chart_cache[cache_key] = (result, now)
    return result


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

def _fetch_details(ticker: str) -> dict:
    info = yf.Ticker(ticker).info
    return {"results": {
        "ticker": ticker.upper(),
        "name": info.get("longName") or info.get("shortName", ""),
        "description": info.get("longBusinessSummary", ""),
        "market_cap": info.get("marketCap", 0),
        "total_employees": info.get("fullTimeEmployees", 0),
        "pe_ratio": info.get("trailingPE"),
        "week_52_high": info.get("fiftyTwoWeekHigh"),
        "week_52_low": info.get("fiftyTwoWeekLow"),
        "sector": info.get("sector", ""),
        "industry": info.get("industry", ""),
    }}


async def get_ticker_details(ticker: str) -> dict:
    t = ticker.upper()
    now = time.time()
    if t in _details_cache:
        data, ts = _details_cache[t]
        if now - ts < _DETAILS_TTL:
            return data
    result = await _run(_fetch_details, t)
    _details_cache[t] = (result, now)
    return result


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


_UNIVERSE = [
    "AAPL", "MSFT", "NVDA", "AMZN", "GOOGL", "META", "TSLA", "AMD",
    "NFLX", "PYPL", "DIS", "BA", "JPM", "GS", "WMT", "XOM", "CVX",
    "PFE", "JNJ", "V",
    # Extended core
    "IBM", "C", "F", "GM", "INTU", "LMT", "RTX", "MDLZ", "PM", "BKNG",
    # New additions
    "SHOP", "SQ", "ZM", "UBER", "LYFT", "COIN", "ROKU", "SPOT", "TWLO", "OKTA", "DOCU",
    "SPGI", "MCO", "MSCI", "NDAQ", "TROW", "FISV", "FIS", "ADP", "BRK-B",
    "MRNA", "VRTX", "HUM", "CI", "ELV", "ABT", "ZTS",
    "LULU", "TJX", "DG", "DLTR", "AZO", "ORLY", "KR",
    "TMUS", "CMCSA", "CHTR",
    "DVN", "BKR",
    "FDX", "UNP", "CSX", "NSC", "WM",
    "ALB", "SHW", "PPG", "ECL", "IFF",
    "EQIX", "CCI",
    "XEL", "WEC", "AWK",
    "ADI", "LRCX", "KLAC",
]


def _fetch_gainers_losers() -> dict:
    # Download 2 days so we can compute prev-close → last-close change
    raw = yf.download(
        _UNIVERSE, period="2d", interval="1d",
        auto_adjust=True, progress=False, threads=True,
    )
    close = raw["Close"]
    if len(close) < 2:
        return {"gainers": [], "losers": []}

    last  = close.iloc[-1]
    prev  = close.iloc[-2]
    pct   = ((last - prev) / prev * 100).dropna()

    stocks = []
    for ticker in pct.index:
        try:
            stocks.append({
                "ticker": str(ticker),
                "price": round(float(last[ticker]), 2),
                "change_pct": round(float(pct[ticker]), 2),
                "volume": 0,
            })
        except Exception:
            pass

    stocks.sort(key=lambda x: x["change_pct"], reverse=True)
    return {"gainers": stocks[:6], "losers": list(reversed(stocks[-6:]))}


async def get_gainers_losers() -> dict:
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
        ex_div_date = datetime.fromtimestamp(int(raw_ex)).strftime("%b %d, %Y") if raw_ex else ""
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


# ── News ───────────────────────────────────────────────────────────────────

def _fetch_news_yf(ticker: str | None, limit: int) -> list[dict]:
    if ticker:
        articles = yf.Ticker(ticker).news or []
    else:
        # General market news: merge news from index ETFs
        seen, articles = set(), []
        for sym in ["SPY", "QQQ", "AAPL"]:
            for a in (yf.Ticker(sym).news or []):
                uid = a.get("id") or a.get("uuid") or a.get("link") or None
                if uid and uid not in seen:
                    seen.add(uid)
                    articles.append(a)
            if len(articles) >= limit:
                break

    results = []
    for a in articles[:limit]:
        content = a.get("content", {})
        # yfinance >=0.2.50 wraps fields under "content"
        title     = content.get("title") or a.get("title", "")
        _canonical = content.get("canonicalUrl")
        link       = (_canonical.get("url") if isinstance(_canonical, dict) else None) or a.get("link", "")
        _provider  = content.get("provider")
        publisher  = (_provider.get("displayName") if isinstance(_provider, dict) else None) or a.get("publisher", "Yahoo Finance")
        pub_ts    = a.get("providerPublishTime") or 0
        thumbnail = a.get("thumbnail", {})
        resolutions = thumbnail.get("resolutions", []) if isinstance(thumbnail, dict) else []
        image = resolutions[0].get("url", "") if resolutions else ""

        try:
            pub_iso = datetime.fromtimestamp(pub_ts).isoformat() + "Z" if pub_ts else ""
        except Exception:
            pub_iso = ""

        results.append({
            "id": link or (str(pub_ts) if pub_ts else str(id(a))),
            "title": title,
            "description": "",
            "article_url": link,
            "image_url": image,
            "published_utc": pub_iso,
            "publisher": {"name": publisher},
        })
    return results


async def get_news(ticker: str = None, limit: int = 10) -> dict:
    cache_key = ticker.upper() if ticker else "__market__"
    now = time.time()
    if cache_key in _news_cache:
        data, ts = _news_cache[cache_key]
        if now - ts < _NEWS_TTL:
            return data
    results = await _run(_fetch_news_yf, ticker, limit)
    payload = {"results": results, "status": "OK"}
    _news_cache[cache_key] = (payload, now)
    return payload


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

_EXTENDED_UNIVERSE = [
    "AAPL", "MSFT", "NVDA", "AMZN", "GOOGL", "META", "TSLA", "AMD",
    "NFLX", "PYPL", "DIS", "BA", "JPM", "GS", "WMT", "XOM", "CVX",
    "PFE", "JNJ", "V", "INTC", "CRM", "ADBE", "CSCO", "QCOM",
    "TXN", "AMAT", "SBUX", "NKE", "HD", "LOW", "TGT", "COST",
    "MCD", "CMG", "AVGO", "MU", "ORCL", "UBER", "LYFT",
    "IBM", "INTU", "NOW", "SNOW", "PLTR", "CRWD", "PANW", "NET",
    "C", "USB", "COF", "SCHW", "ICE", "CME",
    "BMY", "ISRG", "MDT", "DHR", "REGN",
    "F", "GM", "BKNG", "ABNB", "MAR", "HLT",
    "SNAP", "PINS", "RBLX", "EA",
    "OXY", "PSX", "VLO", "HAL",
    "LMT", "RTX", "MMM", "EMR", "ETN",
    "MDLZ", "PM", "STZ", "MO",
    "DOW", "NUE", "SPG", "SO", "D",
    # New additions
    "SHOP", "SQ", "ZM", "COIN", "ROKU", "SPOT", "TWLO", "OKTA", "DOCU",
    "SPGI", "MCO", "MSCI", "NDAQ", "TROW", "FISV", "FIS", "ADP", "BRK-B",
    "MRNA", "VRTX", "HUM", "CI", "ELV", "ABT", "ZTS",
    "LULU", "TJX", "DG", "DLTR", "AZO", "ORLY", "KR",
    "TMUS", "CMCSA", "CHTR",
    "DVN", "BKR",
    "FDX", "UNP", "CSX", "NSC", "WM",
    "ALB", "SHW", "PPG", "ECL", "IFF",
    "EQIX", "CCI",
    "XEL", "WEC", "AWK",
    "ADI", "LRCX", "KLAC",
]


def _fetch_market_update() -> dict:
    etf_tickers = [s[0] for s in _SECTOR_ETFS]
    etf_names   = {s[0]: s[1] for s in _SECTOR_ETFS}
    all_tickers = etf_tickers + _EXTENDED_UNIVERSE

    raw = yf.download(
        all_tickers, period="2d", interval="1d",
        auto_adjust=True, progress=False, threads=True,
    )
    close = raw["Close"]
    if len(close) < 2:
        return {"sectors": [], "gainers": [], "losers": [], "breadth": {"advances": 0, "declines": 0, "unchanged": 0, "total": 0}}

    last = close.iloc[-1]
    prev = close.iloc[-2]
    pct  = ((last - prev) / prev * 100).dropna()

    # Sectors
    sectors = []
    for ticker in etf_tickers:
        try:
            sectors.append({
                "ticker":     ticker,
                "name":       etf_names[ticker],
                "price":      round(float(last[ticker]), 2),
                "change_pct": round(float(pct[ticker]), 2),
            })
        except Exception:
            pass
    sectors.sort(key=lambda x: x["change_pct"], reverse=True)

    # Extended gainers / losers
    stocks = []
    for ticker in _EXTENDED_UNIVERSE:
        try:
            stocks.append({
                "ticker":     ticker,
                "price":      round(float(last[ticker]), 2),
                "change_pct": round(float(pct[ticker]), 2),
            })
        except Exception:
            pass
    stocks.sort(key=lambda x: x["change_pct"], reverse=True)

    # Breadth across whole universe
    all_changes = []
    for ticker in all_tickers:
        try:
            all_changes.append(float(pct[ticker]))
        except Exception:
            pass
    advances  = sum(1 for c in all_changes if c > 0)
    declines  = sum(1 for c in all_changes if c < 0)
    unchanged = sum(1 for c in all_changes if c == 0)

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


async def get_market_update() -> dict:
    global _update_cache
    now = time.time()
    if _update_cache is not None:
        data, ts = _update_cache
        if now - ts < _UPDATE_TTL:
            return data
    result = await _run(_fetch_market_update)
    _update_cache = (result, now)
    return result


# ── Mutual Funds / ETF Screener ────────────────────────────────────────────

_FUND_CATEGORIES = {
    "Broad Market": ["SPY", "QQQ", "IWM", "VTI", "DIA", "MDY"],
    "Bonds":        ["BND", "AGG", "TLT", "SHY", "HYG", "LQD"],
    "International":["EFA", "EEM", "VWO", "IEFA", "VEA", "ACWI"],
    "Commodities":  ["GLD", "SLV", "USO", "GDX", "PDBC", "DBC"],
    "Real Assets":  ["VNQ", "XLRE", "IYR", "SCHH", "REM", "MORT"],
}


def _fetch_fund_category(tickers: list[str]) -> list[dict]:
    raw = yf.download(
        tickers, period="2d", interval="1d",
        auto_adjust=True, progress=False, threads=True,
    )
    close = raw["Close"]
    results = []
    for ticker in tickers:
        try:
            info = yf.Ticker(ticker).info
            last  = float(close[ticker].iloc[-1])
            prev  = float(close[ticker].iloc[-2]) if len(close) >= 2 else last
            chg   = ((last - prev) / prev * 100) if prev else 0
            # Compute YTD return from Jan 1 close to avoid yfinance ytdReturn inconsistencies
            try:
                year_start = datetime(datetime.now().year, 1, 1)
                hist_ytd = yf.Ticker(ticker).history(
                    start=year_start.strftime("%Y-%m-%d"),
                    end=datetime.now().strftime("%Y-%m-%d"),
                    interval="1d",
                )
                if len(hist_ytd) >= 2:
                    ytd_start = float(hist_ytd["Close"].iloc[0])
                    ytd_return = round((last - ytd_start) / ytd_start * 100, 2) if ytd_start else 0.0
                else:
                    ytd_return = 0.0
            except Exception:
                ytd_return = 0.0
            results.append({
                "ticker":       ticker,
                "name":         info.get("longName") or info.get("shortName", ticker),
                "price":        round(last, 2),
                "change_pct":   round(chg, 2),
                "expense_ratio": round((info.get("annualReportExpenseRatio") or
                                        info.get("expenseRatio") or 0) * 100, 3),
                "aum_b":        round((info.get("totalAssets") or 0) / 1e9, 2),
                "ytd_return":   ytd_return,
                "category":     info.get("category", ""),
            })
        except Exception:
            pass
    return results


async def get_funds(category: str) -> list[dict]:
    tickers = _FUND_CATEGORIES.get(category, [])
    if not tickers:
        return []
    now = time.time()
    if category in _funds_cache:
        data, ts = _funds_cache[category]
        if now - ts < _FUNDS_TTL:
            return data
    result = await _run(_fetch_fund_category, tickers)
    _funds_cache[category] = (result, now)
    return result


def get_fund_categories() -> list[str]:
    return list(_FUND_CATEGORIES.keys())


# ── Stock Screener ─────────────────────────────────────────────────────────

_SCREENER_UNIVERSE = [
    # Technology (40)
    "AAPL", "MSFT", "NVDA", "AMD", "INTC", "CSCO", "ORCL", "CRM", "ADBE", "QCOM",
    "TXN", "AMAT", "AVGO", "MU", "IBM", "INTU", "NOW", "SNOW", "PLTR", "CRWD",
    "PANW", "NET", "ZS", "FTNT", "DDOG", "TEAM", "MDB", "HPQ", "DELL",
    "SHOP", "SQ", "ZM", "UBER", "LYFT", "TWLO", "OKTA", "DOCU", "ADI", "LRCX", "KLAC",
    # Financials (28)
    "JPM", "GS", "BAC", "WFC", "MS", "V", "MA", "PYPL", "AXP", "BLK",
    "C", "USB", "PNC", "COF", "SCHW", "ICE", "CME", "TFC",
    "SPGI", "MCO", "MSCI", "NDAQ", "TROW", "FISV", "FIS", "ADP", "COIN", "BRK-B",
    # Healthcare (24)
    "JNJ", "PFE", "MRK", "ABBV", "UNH", "LLY", "AMGN", "GILD", "CVS",
    "BMY", "BIIB", "REGN", "ISRG", "BSX", "MDT", "ZBH", "DHR",
    "MRNA", "VRTX", "HUM", "CI", "ELV", "ABT", "ZTS",
    # Consumer Discretionary (25)
    "AMZN", "TSLA", "HD", "LOW", "NKE", "MCD", "SBUX", "CMG", "TGT", "COST",
    "F", "GM", "BKNG", "ABNB", "MAR", "HLT", "EBAY", "LVS",
    "LULU", "TJX", "DG", "DLTR", "AZO", "ORLY", "KR",
    # Communication Services (16)
    "META", "GOOGL", "NFLX", "DIS", "T", "VZ",
    "SNAP", "PINS", "RBLX", "EA", "WBD",
    "ROKU", "SPOT", "TMUS", "CMCSA", "CHTR",
    # Energy (12)
    "XOM", "CVX", "COP", "SLB", "EOG",
    "OXY", "PSX", "VLO", "MPC", "HAL",
    "DVN", "BKR",
    # Industrials (18)
    "BA", "GE", "CAT", "HON", "UPS", "DE",
    "LMT", "RTX", "NOC", "GD", "MMM", "EMR", "ETN",
    "FDX", "UNP", "CSX", "NSC", "WM",
    # Consumer Staples (10)
    "WMT", "PG", "KO", "PEP", "CL",
    "MDLZ", "STZ", "MO", "PM", "EL",
    # Materials (11)
    "FCX", "NEM", "LIN",
    "DOW", "DD", "NUE",
    "ALB", "SHW", "PPG", "ECL", "IFF",
    # Real Estate (7)
    "AMT", "PLD",
    "SPG", "O", "EQR",
    "EQIX", "CCI",
    # Utilities (8)
    "NEE", "DUK",
    "SO", "D", "AEP",
    "XEL", "WEC", "AWK",
]

_screener_data: list = []
_screener_ts: float = 0.0
_screener_fetching: bool = False   # sentinel: True while a fetch is in progress
_screener_lock = threading.Lock()
_SCREENER_TTL = 600  # 10 minutes


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
        _screener_ts = now

    tickers = _SCREENER_UNIVERSE

    # Fetch only 5 days of price data — we need just two rows (last & prev close).
    # 52W return comes from info["52WeekChange"] instead, avoiding a 1-year download.
    raw = yf.download(
        tickers, period="5d", interval="1d",
        auto_adjust=True, progress=False, threads=True,
    )
    close = raw["Close"]

    price_map: dict[str, dict] = {}
    if len(close) >= 2:
        last = close.iloc[-1]
        prev = close.iloc[-2]
        for t in tickers:
            try:
                p  = float(last[t])
                pr = float(prev[t])
                price_map[t] = {
                    "price":      p,
                    "change_pct": ((p - pr) / pr * 100) if pr else 0,
                }
            except Exception:
                pass

    def fetch_info(ticker: str) -> dict | None:
        try:
            info = yf.Ticker(ticker).info
            pd_  = price_map.get(ticker, {})
            pe   = info.get("trailingPE")
            mkt_cap = info.get("marketCap") or 0
            price   = pd_.get("price", 0)
            # 52WeekChange is a decimal fraction in yfinance (0.25 = +25 %)
            raw_52 = info.get("52WeekChange")
            w52r   = round(raw_52 * 100, 2) if raw_52 is not None else None
            div_rate  = info.get("dividendRate") or 0
            div_yield = (div_rate / price * 100) if price > 0 and div_rate > 0 else 0.0
            return {
                "ticker":         ticker,
                "name":           info.get("longName") or info.get("shortName", ticker),
                "sector":         info.get("sector")   or "Other",
                "industry":       info.get("industry") or "",
                "price":          round(price, 2),
                "change_pct":     round(pd_.get("change_pct", 0), 2),
                "week_52_return": w52r,
                "week_52_high":   round(info.get("fiftyTwoWeekHigh") or 0, 2) or None,
                "week_52_low":    round(info.get("fiftyTwoWeekLow")  or 0, 2) or None,
                "market_cap":     mkt_cap,
                "pe_ratio":       round(pe, 2) if pe is not None else None,
                "dividend_yield": round(div_yield, 4),
            }
        except Exception:
            return None

    results: list[dict] = []
    # 24 workers ≈ half as many parallel rounds as before for 142 tickers
    with ThreadPoolExecutor(max_workers=24) as pool:
        futs = {pool.submit(fetch_info, t): t for t in tickers}
        for fut in as_completed(futs):
            r = fut.result()
            if r:
                results.append(r)

    results.sort(key=lambda x: x["market_cap"], reverse=True)
    with _screener_lock:
        _screener_data = results
        _screener_ts   = time.time()  # record actual completion time
        _screener_fetching = False
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
            "allocation_pct": 0,  # filled by the router after aggregation
        }
    except Exception:
        cost = shares * avg_buy_price
        return {
            "ticker": ticker, "name": ticker, "sector": "Other", "industry": "",
            "shares": shares, "avg_buy_price": round(avg_buy_price, 2),
            "current_price": round(avg_buy_price, 2),
            "cost": round(cost, 2), "value": round(cost, 2),
            "pnl": 0, "pnl_pct": 0, "dividend_yield": 0, "allocation_pct": 0,
        }


async def get_portfolio_analytics(items: list[dict]) -> list[dict]:
    tasks = [
        _run(_fetch_portfolio_item, item["ticker"], item["shares"], item["avg_buy_price"])
        for item in items
    ]
    results = await asyncio.gather(*tasks)
    return [r for r in results if r is not None]


async def get_screener() -> list[dict]:
    return await _run(_fetch_screener)


async def stream_screener():
    """Async generator — yields one stock dict at a time as .info calls finish.

    Cache hit  : all stocks yielded immediately (< 100 ms).
    Cache miss : each stock yielded as soon as its yfinance call completes,
                 so the first rows appear within ~1-2 s instead of ~10 s.

    Stampede guard: if _fetch_screener (called via get_screener) is already
    fetching, serve the stale cache immediately rather than launching a second
    parallel fetch. The _screener_fetching sentinel is the shared signal.
    """
    global _screener_data, _screener_ts, _screener_fetching
    # Move the lock check off the event loop onto a thread to avoid blocking
    # the loop if the threading.Lock is briefly contended.
    loop = asyncio.get_running_loop()

    def _check_cache():
        now = time.time()
        with _screener_lock:
            if _screener_data and (now - _screener_ts) < _SCREENER_TTL:
                return "hit", list(_screener_data)
            if _screener_fetching:
                # Another fetch is in progress — return stale data to this caller.
                return "stale", list(_screener_data)
            # Claim the fetch slot.
            _screener_fetching = True  # noqa: PLW0603
            return "miss", []

    status, cached = await loop.run_in_executor(_pool, _check_cache)

    if status in ("hit", "stale"):
        for stock in cached:
            yield stock
        return

    tickers = _SCREENER_UNIVERSE
    loop = asyncio.get_running_loop()

    # Bulk price download is fast (5 days, not 1 year)
    raw = await loop.run_in_executor(_pool, lambda: yf.download(
        tickers, period="5d", interval="1d",
        auto_adjust=True, progress=False, threads=True,
    ))
    close = raw["Close"]
    price_map: dict[str, dict] = {}
    if len(close) >= 2:
        last, prev = close.iloc[-1], close.iloc[-2]
        for t in tickers:
            try:
                p, pr = float(last[t]), float(prev[t])
                price_map[t] = {"price": p, "change_pct": ((p - pr) / pr * 100) if pr else 0}
            except Exception:
                pass

    # Fire all .info calls in parallel; each result is pushed to an asyncio Queue
    # so we can yield it to the HTTP response the instant it arrives.
    queue: asyncio.Queue[dict | None] = asyncio.Queue()

    def _fetch_one(ticker: str) -> None:
        try:
            info  = yf.Ticker(ticker).info
            pd_   = price_map.get(ticker, {})
            price = pd_.get("price", 0)
            pe    = info.get("trailingPE")
            raw52 = info.get("52WeekChange")
            div_r = info.get("dividendRate") or 0
            item  = {
                "ticker":         ticker,
                "name":           info.get("longName") or info.get("shortName", ticker),
                "sector":         info.get("sector")   or "Other",
                "industry":       info.get("industry") or "",
                "price":          round(price, 2),
                "change_pct":     round(pd_.get("change_pct", 0), 2),
                "week_52_return": round(raw52 * 100, 2) if raw52 is not None else None,
                "week_52_high":   round(info.get("fiftyTwoWeekHigh") or 0, 2) or None,
                "week_52_low":    round(info.get("fiftyTwoWeekLow")  or 0, 2) or None,
                "market_cap":     info.get("marketCap") or 0,
                "pe_ratio":       round(pe, 2) if pe is not None else None,
                "dividend_yield": round(
                    (div_r / price * 100) if price > 0 and div_r > 0 else 0, 4
                ),
            }
            loop.call_soon_threadsafe(queue.put_nowait, item)
        except Exception:
            loop.call_soon_threadsafe(queue.put_nowait, None)

    for t in tickers:
        _pool.submit(_fetch_one, t)

    collected: list[dict] = []
    for _ in tickers:
        item = await queue.get()
        if item is not None:
            collected.append(item)
            yield item

    # Persist sorted cache for the next request and release the fetch slot.
    collected.sort(key=lambda x: x["market_cap"], reverse=True)
    with _screener_lock:
        _screener_data = collected
        _screener_ts   = time.time()
        _screener_fetching = False
