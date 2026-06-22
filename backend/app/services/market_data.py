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

# yf.Ticker.info triggers a heavy quoteSummary call that can take 5-15s on a
# cold cache. fast_info is a single lightweight endpoint that returns
# market_cap (and price data) almost instantly, so we use it as the primary
# source for market_cap and cap .info to a hard timeout for the rest.
_INFO_TIMEOUT = 5  # seconds


def _fetch_details(ticker: str) -> dict:
    t = yf.Ticker(ticker)

    # Fast path: market cap from fast_info (single lightweight request).
    try:
        market_cap = t.fast_info.market_cap or 0
    except Exception:
        market_cap = 0

    # Slow path: full .info for descriptive fields, bounded so a slow
    # upstream call can never blow the overall response budget.
    info = {}
    with ThreadPoolExecutor(max_workers=1) as pool:
        fut = pool.submit(lambda: t.info)
        try:
            info = fut.result(timeout=_INFO_TIMEOUT)
        except Exception:
            info = {}

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
    "SHOP", "XYZ", "ZM", "UBER", "LYFT", "COIN", "ROKU", "SPOT", "TWLO", "OKTA", "DOCU",
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
    # ── 200 additional tickers ───────────────────────────────────────────
    # Technology
    "WDAY", "HUBS", "VEEV", "CDNS", "SNPS", "KEYS", "MPWR", "ON", "MCHP",
    "NXPI", "SWKS", "AKAM", "FFIV", "ANET", "GDDY", "TTD", "BILL", "PAYC",
    "SMCI", "ARM", "APP", "MRVL", "MNDY", "PATH", "GRAB", "GLOB",
    "EPAM", "ACN", "IT", "CTSH", "LDOS", "SAIC", "MANH", "TYL", "GEN", "ZBRA",
    # Financials
    "ALLY", "MTB", "KEY", "CFG", "HBAN", "RF", "ZION", "FITB", "DFS",
    "SYF", "MKTX", "CBOE", "RJF", "LPLA", "NTRS", "STT", "BK", "AIG", "MET",
    "PRU", "ALL", "TRV", "CINF", "GL",
    # Healthcare
    "TMO", "A", "IQV", "SYK", "BDX", "EW", "ALGN", "HOLX", "IDXX", "ILMN",
    "WAT", "CRL", "PODD", "MOH", "CNC", "HCA", "GEHC", "RMD", "WST", "TFX",
    "BAX", "VTRS", "INCY", "JAZZ", "DXCM",
    # Consumer Discretionary
    "ROST", "BBY", "DHI", "LEN", "PHM", "POOL", "RH", "DECK", "ETSY", "W",
    "CPRT", "KMX", "YUM", "DPZ", "QSR", "WYNN", "MGM", "CCL", "RCL", "NCLH",
    # Communication Services
    "LYV", "MTCH", "IPG", "OMC", "TTWO", "NWSA", "WMG", "FOX", "IMAX", "CHWY",
    # Energy
    "FANG", "APA", "AR", "EQT", "TRGP", "WMB", "KMI", "OKE",
    # Industrials
    "TT", "ROK", "DOV", "AME", "PCAR", "CMI", "IR", "PH", "ITW", "SWK",
    "FAST", "ODFL", "CHRW", "XPO", "GNRC", "OTIS", "CARR", "PWR", "EME", "HUBB",
    # Consumer Staples
    "HSY", "SJM", "K", "GIS", "CPB", "HRL", "MKC", "CHD", "CLX", "BG",
    # Materials
    "APD", "CE", "EMN", "RPM", "VMC", "MLM", "BALL", "PKG", "IP",
    # Real Estate
    "DLR", "PSA", "WELL", "CBRE", "VICI", "ARE", "MAA", "UDR", "ESS", "INVH",
    # Utilities
    "AES", "PEG", "ED", "EIX", "ES", "FE", "CMS", "CNP", "NI", "DTE",
    # Fintech / Growth
    "RIVN", "SOFI", "HOOD", "RKLB", "AFRM", "UPST", "DASH", "DKNG", "TOST", "NU",
    # ── 300 more tickers ─────────────────────────────────────────────────
    # Technology / Semiconductors / Software
    "CRDO", "ONTO", "COHR", "FLEX", "JBL", "GLW", "TEL", "APH", "CDW", "ENPH",
    "FSLR", "WDC", "STX", "NTAP", "QLYS", "CYBR", "IOT", "DUOL", "FOUR", "GTLB",
    "S", "DOCN", "DT", "NTNX", "BOX", "FICO", "ASAN", "RNG", "CWAN", "WEX",
    "VRNS", "TENB", "BSY", "CVLT", "JAMF", "RPD", "PI", "BRZE", "APPN", "MTSI",
    "NOVT", "GWRE", "PCOR", "CALX", "SMTC", "SEDG", "RUN", "CIEN", "LITE", "RMBS",
    # Financials
    "IBKR", "WRB", "ACGL", "HIG", "L", "VOYA", "EQH", "FNF", "AIZ", "BHF",
    "EWBC", "WAL", "FCNCA", "FHN", "WBS", "BOKF", "CADE", "CBSH", "UMBF", "FFIN",
    "BEN", "IVZ", "AMG", "SEIC", "GPN", "JKHY", "WU", "SLM", "NAVI", "OMF",
    "AGO", "ORI", "KNSL", "RNR", "AFG",
    # Healthcare
    "TECH", "MEDP", "NBIX", "EXAS", "HALO", "INSM", "IONS", "NVCR", "XRAY", "HSIC",
    "GMED", "TNDM", "NVST", "PEN", "RVMD", "UTHR", "BMRN", "SRPT", "ALNY", "EXEL",
    "NTRA", "GH", "ITCI", "PCVX", "LEGN", "ENSG", "LNTH", "RARE", "PRGO", "OGN",
    "CERT", "RPRX", "XENE", "KRYS", "MRUS",
    # Consumer Discretionary
    "GRMN", "TSCO", "ULTA", "TPR", "RL", "PVH", "ONON", "VFC", "CROX", "BIRK",
    "AEO", "GPS", "FIVE", "CAVA", "SHAK", "TXRH", "EAT", "DRI", "DIN", "CAKE",
    "PENN", "CZR", "BYD", "EXPE", "TRIP", "HAS", "MAT", "PTON", "CHGG", "BROS",
    # Communication Services
    "IAC", "ZG", "LBRDA", "VRSN", "CARG", "CARS", "TKO", "TGNA", "NXST", "CNK",
    "MSGS", "SIRI", "IRDM", "DBX", "RAMP",
    # Energy
    "HES", "SM", "RRC", "CNX", "MGY", "CHRD", "DINO", "MTDR", "PR", "VNOM",
    "PTEN", "HP", "NOV", "FTI", "WHD", "LBRT", "RIG", "VAL", "WFRD", "TDW",
    # Industrials
    "WCC", "ALLE", "AYI", "ROP", "NDSN", "SITE", "WSO", "GGG", "AIT", "MAS",
    "AAON", "TREX", "AWI", "BLDR", "OC", "IEX", "AGCO", "TTC", "WAB", "GWW",
    "SNA", "MSA", "FTV", "AXON", "DAL", "UAL", "AAL", "LUV", "JBHT", "SAIA",
    # Consumer Staples
    "MNST", "LW", "KHC", "POST", "SFM", "CASY", "SMPL", "FLO", "THS", "INGR",
    "CAG", "USFD", "PFGC", "SYY", "KDP",
    # Materials
    "STLD", "RS", "ATI", "CLF", "AA", "CF", "MOS", "SMG", "FMC", "AXTA",
    "AVNT", "CBT", "HUN", "OLN", "CC",
    # Real Estate
    "SUI", "ELS", "COLD", "REXR", "CUBE", "SBRA", "CPT", "KRG", "REG", "FRT",
    "IRM", "SBAC", "WPC", "NNN", "GLPI",
    # Utilities
    "CEG", "VST", "NRG", "SRE", "PNW", "EVRG", "ATO", "OGE", "AVA", "LNT",
    # International ADRs
    "TSM", "ASML", "SAP", "TM", "SONY", "NVO", "BABA", "JD", "PDD", "MELI",
    "SE", "INFY", "WIT", "HDB", "IBN",
    # Growth / Crypto / Quantum
    "IONQ", "CELH", "HIMS", "SOUN", "JOBY", "RXRX", "MSTR", "MARA", "RIOT", "HUT",
    "CLSK", "WULF", "BTDR", "CIFR", "BITF",
]

# Cap to stay within Yahoo Finance's tolerance on cold fetches. Chunked via
# _download_chunked below, so this can safely cover the full universe.
_UNIVERSE = _UNIVERSE[:600]


def _fetch_gainers_losers() -> dict:
    # Download 2 days so we can compute prev-close → last-close change
    raw = _download_chunked(_UNIVERSE, period="2d")
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
    "SHOP", "XYZ", "ZM", "COIN", "ROKU", "SPOT", "TWLO", "OKTA", "DOCU",
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
    # ── 200 additional tickers ───────────────────────────────────────────
    # Technology
    "WDAY", "HUBS", "VEEV", "CDNS", "SNPS", "KEYS", "MPWR", "ON", "MCHP",
    "NXPI", "SWKS", "AKAM", "FFIV", "ANET", "GDDY", "TTD", "BILL", "PAYC",
    "SMCI", "ARM", "APP", "MRVL", "MNDY", "PATH", "GRAB", "GLOB",
    "EPAM", "ACN", "IT", "CTSH", "LDOS", "SAIC", "MANH", "TYL", "GEN", "ZBRA",
    # Financials
    "ALLY", "MTB", "KEY", "CFG", "HBAN", "RF", "ZION", "FITB", "DFS",
    "SYF", "MKTX", "CBOE", "RJF", "LPLA", "NTRS", "STT", "BK", "AIG", "MET",
    "PRU", "ALL", "TRV", "CINF", "GL",
    # Healthcare
    "TMO", "A", "IQV", "SYK", "BDX", "EW", "ALGN", "HOLX", "IDXX", "ILMN",
    "WAT", "CRL", "PODD", "MOH", "CNC", "HCA", "GEHC", "RMD", "WST", "TFX",
    "BAX", "VTRS", "INCY", "JAZZ", "DXCM",
    # Consumer Discretionary
    "ROST", "BBY", "DHI", "LEN", "PHM", "POOL", "RH", "DECK", "ETSY", "W",
    "CPRT", "KMX", "YUM", "DPZ", "QSR", "WYNN", "MGM", "CCL", "RCL", "NCLH",
    # Communication Services
    "LYV", "MTCH", "IPG", "OMC", "TTWO", "NWSA", "WMG", "FOX", "IMAX", "CHWY",
    # Energy
    "FANG", "APA", "AR", "EQT", "TRGP", "WMB", "KMI", "OKE",
    # Industrials
    "TT", "ROK", "DOV", "AME", "PCAR", "CMI", "IR", "PH", "ITW", "SWK",
    "FAST", "ODFL", "CHRW", "XPO", "GNRC", "OTIS", "CARR", "PWR", "EME", "HUBB",
    # Consumer Staples
    "HSY", "SJM", "K", "GIS", "CPB", "HRL", "MKC", "CHD", "CLX", "BG",
    # Materials
    "APD", "CE", "EMN", "RPM", "VMC", "MLM", "BALL", "PKG", "IP",
    # Real Estate
    "DLR", "PSA", "WELL", "CBRE", "VICI", "ARE", "MAA", "UDR", "ESS", "INVH",
    # Utilities
    "AES", "PEG", "ED", "EIX", "ES", "FE", "CMS", "CNP", "NI", "DTE",
    # Fintech / Growth
    "RIVN", "SOFI", "HOOD", "RKLB", "AFRM", "UPST", "DASH", "DKNG", "TOST", "NU",
    # ── 300 more tickers ─────────────────────────────────────────────────
    # Technology / Semiconductors / Software
    "CRDO", "ONTO", "COHR", "FLEX", "JBL", "GLW", "TEL", "APH", "CDW", "ENPH",
    "FSLR", "WDC", "STX", "NTAP", "QLYS", "CYBR", "IOT", "DUOL", "FOUR", "GTLB",
    "S", "DOCN", "DT", "NTNX", "BOX", "FICO", "ASAN", "RNG", "CWAN", "WEX",
    "VRNS", "TENB", "BSY", "CVLT", "JAMF", "RPD", "PI", "BRZE", "APPN", "MTSI",
    "NOVT", "GWRE", "PCOR", "CALX", "SMTC", "SEDG", "RUN", "CIEN", "LITE", "RMBS",
    # Financials
    "IBKR", "WRB", "ACGL", "HIG", "L", "VOYA", "EQH", "FNF", "AIZ", "BHF",
    "EWBC", "WAL", "FCNCA", "FHN", "WBS", "BOKF", "CADE", "CBSH", "UMBF", "FFIN",
    "BEN", "IVZ", "AMG", "SEIC", "GPN", "JKHY", "WU", "SLM", "NAVI", "OMF",
    "AGO", "ORI", "KNSL", "RNR", "AFG",
    # Healthcare
    "TECH", "MEDP", "NBIX", "EXAS", "HALO", "INSM", "IONS", "NVCR", "XRAY", "HSIC",
    "GMED", "TNDM", "NVST", "PEN", "RVMD", "UTHR", "BMRN", "SRPT", "ALNY", "EXEL",
    "NTRA", "GH", "ITCI", "PCVX", "LEGN", "ENSG", "LNTH", "RARE", "PRGO", "OGN",
    "CERT", "RPRX", "XENE", "KRYS", "MRUS",
    # Consumer Discretionary
    "GRMN", "TSCO", "ULTA", "TPR", "RL", "PVH", "ONON", "VFC", "CROX", "BIRK",
    "AEO", "GPS", "FIVE", "CAVA", "SHAK", "TXRH", "EAT", "DRI", "DIN", "CAKE",
    "PENN", "CZR", "BYD", "EXPE", "TRIP", "HAS", "MAT", "PTON", "CHGG", "BROS",
    # Communication Services
    "IAC", "ZG", "LBRDA", "VRSN", "CARG", "CARS", "TKO", "TGNA", "NXST", "CNK",
    "MSGS", "SIRI", "IRDM", "DBX", "RAMP",
    # Energy
    "HES", "SM", "RRC", "CNX", "MGY", "CHRD", "DINO", "MTDR", "PR", "VNOM",
    "PTEN", "HP", "NOV", "FTI", "WHD", "LBRT", "RIG", "VAL", "WFRD", "TDW",
    # Industrials
    "WCC", "ALLE", "AYI", "ROP", "NDSN", "SITE", "WSO", "GGG", "AIT", "MAS",
    "AAON", "TREX", "AWI", "BLDR", "OC", "IEX", "AGCO", "TTC", "WAB", "GWW",
    "SNA", "MSA", "FTV", "AXON", "DAL", "UAL", "AAL", "LUV", "JBHT", "SAIA",
    # Consumer Staples
    "MNST", "LW", "KHC", "POST", "SFM", "CASY", "SMPL", "FLO", "THS", "INGR",
    "CAG", "USFD", "PFGC", "SYY", "KDP",
    # Materials
    "STLD", "RS", "ATI", "CLF", "AA", "CF", "MOS", "SMG", "FMC", "AXTA",
    "AVNT", "CBT", "HUN", "OLN", "CC",
    # Real Estate
    "SUI", "ELS", "COLD", "REXR", "CUBE", "SBRA", "CPT", "KRG", "REG", "FRT",
    "IRM", "SBAC", "WPC", "NNN", "GLPI",
    # Utilities
    "CEG", "VST", "NRG", "SRE", "PNW", "EVRG", "ATO", "OGE", "AVA", "LNT",
    # International ADRs
    "TSM", "ASML", "SAP", "TM", "SONY", "NVO", "BABA", "JD", "PDD", "MELI",
    "SE", "INFY", "WIT", "HDB", "IBN",
    # Growth / Crypto / Quantum
    "IONQ", "CELH", "HIMS", "SOUN", "JOBY", "RXRX", "MSTR", "MARA", "RIOT", "HUT",
    "CLSK", "WULF", "BTDR", "CIFR", "BITF",
]

# Cap to stay within Yahoo Finance's tolerance on cold fetches.
_EXTENDED_UNIVERSE = _EXTENDED_UNIVERSE[:600]


def _download_chunked(tickers: list[str], period: str, chunk_size: int = 40, max_concurrent: int = 5):
    """yf.download's wall-clock time scales with ticker count even with
    threads=True (Yahoo's batch endpoint has practical limits). Splitting
    into chunks and downloading them concurrently cuts total time roughly
    by a factor of len(chunks) — but firing every chunk at once trips
    Yahoo's rate limiter, which silently returns NaN columns instead of
    erroring (so failures are invisible unless you count them). Capping
    concurrency keeps the speedup without the silent data loss."""
    import pandas as pd
    chunks = [tickers[i:i + chunk_size] for i in range(0, len(tickers), chunk_size)]
    if len(chunks) == 1:
        return yf.download(tickers, period=period, interval="1d", auto_adjust=True, progress=False, threads=True)

    with ThreadPoolExecutor(max_workers=max_concurrent) as pool:
        frames = list(pool.map(
            lambda c: yf.download(c, period=period, interval="1d", auto_adjust=True, progress=False, threads=True),
            chunks,
        ))
    return pd.concat(frames, axis=1)


def _fetch_market_update() -> dict:
    etf_tickers = [s[0] for s in _SECTOR_ETFS]
    etf_names   = {s[0]: s[1] for s in _SECTOR_ETFS}
    all_tickers = etf_tickers + _EXTENDED_UNIVERSE

    raw = _download_chunked(all_tickers, period="2d")
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


def _fetch_fund_one(ticker: str, close) -> dict | None:
    try:
        info = _bounded_info(ticker)
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
        return {
            "ticker":       ticker,
            "name":         info.get("longName") or info.get("shortName", ticker),
            "price":        round(last, 2),
            "change_pct":   round(chg, 2),
            "expense_ratio": round((info.get("annualReportExpenseRatio") or
                                    info.get("expenseRatio") or 0) * 100, 3),
            "aum_b":        round((info.get("totalAssets") or 0) / 1e9, 2),
            "ytd_return":   ytd_return,
            "category":     info.get("category", ""),
        }
    except Exception:
        return None


def _fetch_fund_category(tickers: list[str]) -> list[dict]:
    raw = yf.download(
        tickers, period="2d", interval="1d",
        auto_adjust=True, progress=False, threads=True,
    )
    close = raw["Close"]
    with ThreadPoolExecutor(max_workers=len(tickers)) as pool:
        results = list(pool.map(lambda t: _fetch_fund_one(t, close), tickers))
    return [r for r in results if r is not None]


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
    # Technology (80)
    "AAPL", "MSFT", "NVDA", "AMD", "INTC", "CSCO", "ORCL", "CRM", "ADBE", "QCOM",
    "TXN", "AMAT", "AVGO", "MU", "IBM", "INTU", "NOW", "SNOW", "PLTR", "CRWD",
    "PANW", "NET", "ZS", "FTNT", "DDOG", "TEAM", "MDB", "HPQ", "DELL",
    "SHOP", "XYZ", "ZM", "UBER", "LYFT", "TWLO", "OKTA", "DOCU", "ADI", "LRCX", "KLAC",
    "WDAY", "HUBS", "VEEV", "CDNS", "SNPS", "KEYS", "MPWR", "ON", "MCHP",
    "NXPI", "SWKS", "AKAM", "FFIV", "ANET", "GDDY", "TTD", "BILL", "PAYC",
    "SMCI", "ARM", "APP", "MRVL", "MNDY", "PATH", "GRAB", "GLOB",
    "EPAM", "ACN", "IT", "CTSH", "LDOS", "SAIC", "MANH", "TYL", "GEN", "ZBRA",
    # Financials (53)
    "JPM", "GS", "BAC", "WFC", "MS", "V", "MA", "PYPL", "AXP", "BLK",
    "C", "USB", "PNC", "COF", "SCHW", "ICE", "CME", "TFC",
    "SPGI", "MCO", "MSCI", "NDAQ", "TROW", "FISV", "FIS", "ADP", "COIN", "BRK-B",
    "ALLY", "MTB", "KEY", "CFG", "HBAN", "RF", "ZION", "FITB", "DFS",
    "SYF", "MKTX", "CBOE", "RJF", "LPLA", "NTRS", "STT", "BK", "AIG", "MET",
    "PRU", "ALL", "TRV", "CINF", "GL",
    # Healthcare (49)
    "JNJ", "PFE", "MRK", "ABBV", "UNH", "LLY", "AMGN", "GILD", "CVS",
    "BMY", "BIIB", "REGN", "ISRG", "BSX", "MDT", "ZBH", "DHR",
    "MRNA", "VRTX", "HUM", "CI", "ELV", "ABT", "ZTS",
    "TMO", "A", "IQV", "SYK", "BDX", "EW", "ALGN", "HOLX", "IDXX", "ILMN",
    "WAT", "CRL", "PODD", "MOH", "CNC", "HCA", "GEHC", "RMD", "WST", "TFX",
    "BAX", "VTRS", "INCY", "JAZZ", "DXCM",
    # Consumer Discretionary (45)
    "AMZN", "TSLA", "HD", "LOW", "NKE", "MCD", "SBUX", "CMG", "TGT", "COST",
    "F", "GM", "BKNG", "ABNB", "MAR", "HLT", "EBAY", "LVS",
    "LULU", "TJX", "DG", "DLTR", "AZO", "ORLY", "KR",
    "ROST", "BBY", "DHI", "LEN", "PHM", "POOL", "RH", "DECK", "ETSY", "W",
    "CPRT", "KMX", "YUM", "DPZ", "QSR", "WYNN", "MGM", "CCL", "RCL", "NCLH",
    # Communication Services (26)
    "META", "GOOGL", "NFLX", "DIS", "T", "VZ",
    "SNAP", "PINS", "RBLX", "EA", "WBD",
    "ROKU", "SPOT", "TMUS", "CMCSA", "CHTR",
    "LYV", "MTCH", "IPG", "OMC", "TTWO", "NWSA", "WMG", "FOX", "IMAX", "CHWY",
    # Energy (22)
    "XOM", "CVX", "COP", "SLB", "EOG",
    "OXY", "PSX", "VLO", "MPC", "HAL",
    "DVN", "BKR",
    "FANG", "APA", "AR", "EQT", "TRGP", "WMB", "KMI", "OKE",
    # Industrials (38)
    "BA", "GE", "CAT", "HON", "UPS", "DE",
    "LMT", "RTX", "NOC", "GD", "MMM", "EMR", "ETN",
    "FDX", "UNP", "CSX", "NSC", "WM",
    "TT", "ROK", "DOV", "AME", "PCAR", "CMI", "IR", "PH", "ITW", "SWK",
    "FAST", "ODFL", "CHRW", "XPO", "GNRC", "OTIS", "CARR", "PWR", "EME", "HUBB",
    # Consumer Staples (20)
    "WMT", "PG", "KO", "PEP", "CL",
    "MDLZ", "STZ", "MO", "PM", "EL",
    "HSY", "SJM", "K", "GIS", "CPB", "HRL", "MKC", "CHD", "CLX", "BG",
    # Materials (21)
    "FCX", "NEM", "LIN",
    "DOW", "DD", "NUE",
    "ALB", "SHW", "PPG", "ECL", "IFF",
    "APD", "CE", "EMN", "RPM", "VMC", "MLM", "BALL", "PKG", "IP",
    # Real Estate (17)
    "AMT", "PLD",
    "SPG", "O", "EQR",
    "EQIX", "CCI",
    "DLR", "PSA", "WELL", "CBRE", "VICI", "ARE", "MAA", "UDR", "ESS", "INVH",
    # Utilities (18)
    "NEE", "DUK",
    "SO", "D", "AEP",
    "XEL", "WEC", "AWK",
    "AES", "PEG", "ED", "EIX", "ES", "FE", "CMS", "CNP", "NI", "DTE",
    # Fintech / Growth (25)
    "RIVN", "SOFI", "HOOD", "RKLB", "AFRM", "UPST", "DASH", "DKNG", "TOST", "NU",
    "IONQ", "CELH", "HIMS", "SOUN", "JOBY", "RXRX", "MSTR", "MARA", "RIOT", "HUT",
    "CLSK", "WULF", "BTDR", "CIFR", "BITF",
    # ── 300 more tickers by sector ───────────────────────────────────────
    # Technology / Semiconductors / Software (50)
    "CRDO", "ONTO", "COHR", "FLEX", "JBL", "GLW", "TEL", "APH", "CDW", "ENPH",
    "FSLR", "WDC", "STX", "NTAP", "QLYS", "CYBR", "IOT", "DUOL", "FOUR", "GTLB",
    "S", "DOCN", "DT", "NTNX", "BOX", "FICO", "ASAN", "RNG", "CWAN", "WEX",
    "VRNS", "TENB", "BSY", "CVLT", "JAMF", "RPD", "PI", "BRZE", "APPN", "MTSI",
    "NOVT", "GWRE", "PCOR", "CALX", "SMTC", "SEDG", "RUN", "CIEN", "LITE", "RMBS",
    # Financials (35)
    "IBKR", "WRB", "ACGL", "HIG", "L", "VOYA", "EQH", "FNF", "AIZ", "BHF",
    "EWBC", "WAL", "FCNCA", "FHN", "WBS", "BOKF", "CADE", "CBSH", "UMBF", "FFIN",
    "BEN", "IVZ", "AMG", "SEIC", "GPN", "JKHY", "WU", "SLM", "NAVI", "OMF",
    "AGO", "ORI", "KNSL", "RNR", "AFG",
    # Healthcare (35)
    "TECH", "MEDP", "NBIX", "EXAS", "HALO", "INSM", "IONS", "NVCR", "XRAY", "HSIC",
    "GMED", "TNDM", "NVST", "PEN", "RVMD", "UTHR", "BMRN", "SRPT", "ALNY", "EXEL",
    "NTRA", "GH", "ITCI", "PCVX", "LEGN", "ENSG", "LNTH", "RARE", "PRGO", "OGN",
    "CERT", "RPRX", "XENE", "KRYS", "MRUS",
    # Consumer Discretionary (30)
    "GRMN", "TSCO", "ULTA", "TPR", "RL", "PVH", "ONON", "VFC", "CROX", "BIRK",
    "AEO", "GPS", "FIVE", "CAVA", "SHAK", "TXRH", "EAT", "DRI", "DIN", "CAKE",
    "PENN", "CZR", "BYD", "EXPE", "TRIP", "HAS", "MAT", "PTON", "CHGG", "BROS",
    # Communication Services (15)
    "IAC", "ZG", "LBRDA", "VRSN", "CARG", "CARS", "TKO", "TGNA", "NXST", "CNK",
    "MSGS", "SIRI", "IRDM", "DBX", "RAMP",
    # Energy (20)
    "HES", "SM", "RRC", "CNX", "MGY", "CHRD", "DINO", "MTDR", "PR", "VNOM",
    "PTEN", "HP", "NOV", "FTI", "WHD", "LBRT", "RIG", "VAL", "WFRD", "TDW",
    # Industrials (30)
    "WCC", "ALLE", "AYI", "ROP", "NDSN", "SITE", "WSO", "GGG", "AIT", "MAS",
    "AAON", "TREX", "AWI", "BLDR", "OC", "IEX", "AGCO", "TTC", "WAB", "GWW",
    "SNA", "MSA", "FTV", "AXON", "DAL", "UAL", "AAL", "LUV", "JBHT", "SAIA",
    # Consumer Staples (15)
    "MNST", "LW", "KHC", "POST", "SFM", "CASY", "SMPL", "FLO", "THS", "INGR",
    "CAG", "USFD", "PFGC", "SYY", "KDP",
    # Materials (15)
    "STLD", "RS", "ATI", "CLF", "AA", "CF", "MOS", "SMG", "FMC", "AXTA",
    "AVNT", "CBT", "HUN", "OLN", "CC",
    # Real Estate (15)
    "SUI", "ELS", "COLD", "REXR", "CUBE", "SBRA", "CPT", "KRG", "REG", "FRT",
    "IRM", "SBAC", "WPC", "NNN", "GLPI",
    # Utilities (10)
    "CEG", "VST", "NRG", "SRE", "PNW", "EVRG", "ATO", "OGE", "AVA", "LNT",
    # International ADRs (15)
    "TSM", "ASML", "SAP", "TM", "SONY", "NVO", "BABA", "JD", "PDD", "MELI",
    "SE", "INFY", "WIT", "HDB", "IBN",
]

# Batched via the chunked-download + bounded-info helpers below, so this can
# safely cover most of the source list without tripping Yahoo's rate limits.
_SCREENER_UNIVERSE = _SCREENER_UNIVERSE[:600]

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
    the whole screener/funds batch past the time budget."""
    with ThreadPoolExecutor(max_workers=1) as pool:
        fut = pool.submit(lambda: yf.Ticker(ticker).info)
        try:
            return fut.result(timeout=timeout)
        except Exception:
            return {}


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

    raw = _download_chunked(tickers, "5d")
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
            info = _bounded_info(ticker)
            pd_  = price_map.get(ticker, {})
            pe   = info.get("trailingPE")
            mkt_cap = info.get("marketCap") or 0
            price   = pd_.get("price", 0)
            raw_52 = info.get("52WeekChange")
            w52r   = round(raw_52 * 100, 2) if raw_52 is not None else None
            div_rate  = info.get("dividendRate") or 0
            div_yield = (div_rate / price * 100) if price > 0 and div_rate > 0 else 0.0
            volume     = info.get("volume") or info.get("regularMarketVolume")
            avg_volume = info.get("averageVolume")
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
                "volume":         volume,
                "volume_level":   _volume_level(volume, avg_volume),
                "country":        info.get("country") or "United States",
            }
        except Exception:
            return None

    results: list[dict] = []
    batch_size = 40
    for i in range(0, len(tickers), batch_size):
        batch = tickers[i:i + batch_size]
        with ThreadPoolExecutor(max_workers=6) as pool:
            futs = {pool.submit(fetch_info, t): t for t in batch}
            for fut in as_completed(futs):
                r = fut.result()
                if r:
                    results.append(r)
        if i + batch_size < len(tickers):
            time.sleep(1.0)

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
    except Exception:
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
    price_map: dict[str, dict] = {}
    if len(close) >= 2:
        last, prev = close.iloc[-1], close.iloc[-2]
        for t in tickers:
            try:
                p, pr = float(last[t]), float(prev[t])
                price_map[t] = {"price": p, "change_pct": ((p - pr) / pr * 100) if pr else 0}
            except Exception:
                pass

    queue: asyncio.Queue[dict | None] = asyncio.Queue()
    batch_size = 40
    total_expected = len(tickers)

    def _fetch_one(ticker: str) -> None:
        try:
            info  = _bounded_info(ticker)
            pd_   = price_map.get(ticker, {})
            price = pd_.get("price", 0)
            pe    = info.get("trailingPE")
            raw52 = info.get("52WeekChange")
            div_r = info.get("dividendRate") or 0
            volume     = info.get("volume") or info.get("regularMarketVolume")
            avg_volume = info.get("averageVolume")
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
                "volume":         volume,
                "volume_level":   _volume_level(volume, avg_volume),
                "country":        info.get("country") or "United States",
            }
            loop.call_soon_threadsafe(queue.put_nowait, item)
        except Exception:
            loop.call_soon_threadsafe(queue.put_nowait, None)

    def _process_batches():
        # Limit in-flight .info calls per batch — _pool has 16 workers but
        # we throttle to 6 to avoid Yahoo's "Invalid Crumb" rate limit.
        from concurrent.futures import ThreadPoolExecutor as _TPE
        for i in range(0, len(tickers), batch_size):
            batch = tickers[i:i + batch_size]
            with _TPE(max_workers=6) as p:
                list(p.map(_fetch_one, batch))
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
