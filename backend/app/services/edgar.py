"""
SEC EDGAR client — pulls a company's entire filing history and XBRL
financial facts directly from the SEC's free, keyless APIs.

Endpoints used:
  * https://www.sec.gov/files/company_tickers.json          ticker → CIK map
  * https://data.sec.gov/submissions/CIK##########.json     filing index
  * https://data.sec.gov/api/xbrl/companyfacts/CIK#####.json  all XBRL facts

The SEC requires a descriptive User-Agent and asks for <10 req/s; this
module makes at most 3 requests per report and caches the heavy payloads.
"""
import asyncio
import logging
import time
from datetime import date as _date

import certifi
import httpx

logger = logging.getLogger(__name__)

_UA = {"User-Agent": "MarketCap Research Tool (contact: admin@marketcap.app)"}

# Ticker→CIK map: one ~2MB file covering every registrant. Refresh daily.
_TICKER_MAP_TTL = 24 * 3600
_ticker_map: dict[str, int] = {}
_ticker_map_ts: float = 0.0
_ticker_map_lock = asyncio.Lock()

# Company facts are large (1-10MB) and change at most quarterly; cache a
# handful so repeated reports on the same ticker don't re-download.
_FACTS_TTL = 6 * 3600
_facts_cache: dict[str, tuple[dict, float]] = {}
_FACTS_CACHE_MAX = 8


async def _get_json(url: str, timeout: float = 30.0) -> dict:
    async with httpx.AsyncClient(timeout=timeout, verify=certifi.where(), headers=_UA) as client:
        r = await client.get(url)
        r.raise_for_status()
        return r.json()


async def get_cik(ticker: str) -> int | None:
    """Resolve a ticker to its SEC CIK number. Returns None if unknown."""
    global _ticker_map, _ticker_map_ts
    # Check while holding the lock; serve from cache without fetching.
    async with _ticker_map_lock:
        if _ticker_map and time.time() - _ticker_map_ts <= _TICKER_MAP_TTL:
            return _ticker_map.get(ticker.upper())
    # Cache is stale — fetch the 2 MB map WITHOUT holding the lock so concurrent
    # CIK lookups don't block for the full network round-trip (up to 30 s).
    data = await _get_json("https://www.sec.gov/files/company_tickers.json")
    new_map = {v["ticker"].upper(): int(v["cik_str"]) for v in data.values()}
    async with _ticker_map_lock:
        # Guard against a parallel fetch that may have already refreshed.
        if not _ticker_map or time.time() - _ticker_map_ts > _TICKER_MAP_TTL:
            _ticker_map = new_map
            _ticker_map_ts = time.time()
    return _ticker_map.get(ticker.upper())


async def get_submissions(cik: int) -> dict:
    """Filing index: company metadata + every filing's form/date/accession."""
    return await _get_json(f"https://data.sec.gov/submissions/CIK{cik:010d}.json")


async def get_company_facts(cik: int) -> dict:
    """All XBRL facts the company has ever reported, keyed by us-gaap tag."""
    key = f"{cik:010d}"
    entry = _facts_cache.get(key)
    if entry and time.time() - entry[1] < _FACTS_TTL:
        return entry[0]
    data = await _get_json(f"https://data.sec.gov/api/xbrl/companyfacts/CIK{key}.json", timeout=60.0)
    if len(_facts_cache) >= _FACTS_CACHE_MAX:
        oldest = min(_facts_cache, key=lambda k: _facts_cache[k][1])
        _facts_cache.pop(oldest, None)
    _facts_cache[key] = (data, time.time())
    return data


# ── Annual series extraction ───────────────────────────────────────────────
# XBRL concept names changed over the years (e.g. revenue moved from
# "Revenues"/"SalesRevenueNet" to "RevenueFromContractWithCustomer..." after
# ASC 606 in 2018), so each logical metric maps to an ordered list of tag
# fallbacks. Values from a higher-priority tag win for a given fiscal year;
# lower-priority tags only fill years the first tag doesn't cover — this
# stitches pre- and post-2018 revenue into one continuous series.

_DURATION = "duration"   # income/cash-flow items reported over a period
_INSTANT = "instant"     # balance-sheet items reported at a point in time

METRIC_TAGS: dict[str, tuple[str, list[str]]] = {
    "revenue": (_DURATION, [
        "Revenues",
        "RevenueFromContractWithCustomerExcludingAssessedTax",
        "RevenueFromContractWithCustomerIncludingAssessedTax",
        "SalesRevenueNet",
        "SalesRevenueGoodsNet",
    ]),
    "gross_profit": (_DURATION, ["GrossProfit"]),
    "operating_income": (_DURATION, ["OperatingIncomeLoss"]),
    "net_income": (_DURATION, ["NetIncomeLoss"]),
    "rnd": (_DURATION, ["ResearchAndDevelopmentExpense"]),
    "ocf": (_DURATION, [
        "NetCashProvidedByUsedInOperatingActivities",
        "NetCashProvidedByUsedInOperatingActivitiesContinuingOperations",
    ]),
    "capex": (_DURATION, ["PaymentsToAcquirePropertyPlantAndEquipment"]),
    "assets": (_INSTANT, ["Assets"]),
    "liabilities": (_INSTANT, ["Liabilities"]),
    "equity": (_INSTANT, [
        "StockholdersEquity",
        "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest",
    ]),
    "cash": (_INSTANT, ["CashAndCashEquivalentsAtCarryingValue"]),
    "current_assets": (_INSTANT, ["AssetsCurrent"]),
    "current_liabilities": (_INSTANT, ["LiabilitiesCurrent"]),
    "long_term_debt": (_INSTANT, ["LongTermDebtNoncurrent", "LongTermDebt"]),
    "retained_earnings": (_INSTANT, ["RetainedEarningsAccumulatedDeficit"]),
}

_EPS_TAGS = ["EarningsPerShareDiluted", "EarningsPerShareBasic"]
_SHARES_TAGS = [
    "WeightedAverageNumberOfDilutedSharesOutstanding",
    "WeightedAverageNumberOfSharesOutstandingBasic",
]


def _annual_points(tag_data: dict, kind: str, unit: str = "USD") -> dict[int, float]:
    """Extract one value per fiscal year from a tag's fact list.

    Annual duration facts are identified by a ~1-year start→end span (which
    excludes quarterly facts filed in 10-Qs); instant facts by coming from a
    10-K. When the same year appears in multiple filings (originals plus
    restatements in later 10-Ks), the most recently filed value wins — that
    matches how analysts treat restated figures.
    """
    points: dict[int, tuple[float, str]] = {}  # year -> (value, filed_date)
    units = tag_data.get("units", {})
    facts = units.get(unit) or units.get(f"{unit}/shares") or []
    for f in facts:
        try:
            form = f.get("form", "")
            end = f.get("end", "")
            val = f.get("val")
            filed = f.get("filed", "")
            if val is None or not end:
                continue
            if kind == _DURATION:
                start = f.get("start", "")
                if not start:
                    continue
                # ~annual span (330-370 days) — excludes quarterly facts and
                # 13-month fiscal-year transitions (10-KT). Use real date
                # arithmetic; the month*30 approximation accepted 13-month spans.
                try:
                    y0, m0, d0 = (int(x) for x in start.split("-"))
                    y1, m1, d1 = (int(x) for x in end.split("-"))
                    span_days = (_date(y1, m1, d1) - _date(y0, m0, d0)).days
                except ValueError:
                    continue
                # 330–380: accepts standard 52-week years (364–366 d) AND
                # 53-week fiscal years (371–372 d, e.g. Walmart/Target).
                # Anything outside this range is a quarter or a 13-month
                # transition period (10-KT) and is excluded.
                if not (330 <= span_days <= 380):
                    continue
            else:
                if form not in ("10-K", "10-K/A", "20-F"):
                    continue
            year = int(end[:4])
            # Fiscal years ending in Jan-Jun conventionally label the prior
            # calendar year (e.g. FY ending 2024-01-31 is "FY2023").
            if int(end[5:7]) <= 6:
                year -= 1
            prev = points.get(year)
            if prev is None or filed > prev[1]:
                points[year] = (float(val), filed)
        except (ValueError, TypeError, KeyError):
            continue
    return {y: v for y, (v, _) in points.items()}


def extract_annual_series(facts: dict) -> dict[str, list[dict]]:
    """Build {metric: [{year, value}, ...]} for every metric in METRIC_TAGS,
    plus EPS and share count. Series are sorted by year ascending."""
    gaap = facts.get("facts", {}).get("us-gaap", {})
    out: dict[str, list[dict]] = {}

    for metric, (kind, tags) in METRIC_TAGS.items():
        merged: dict[int, float] = {}
        for tag in tags:
            if tag not in gaap:
                continue
            for year, val in _annual_points(gaap[tag], kind).items():
                merged.setdefault(year, val)
        out[metric] = [{"year": y, "value": merged[y]} for y in sorted(merged)]

    for name, tags, unit in [("eps", _EPS_TAGS, "USD/shares"), ("shares", _SHARES_TAGS, "shares")]:
        merged = {}
        for tag in tags:
            if tag not in gaap:
                continue
            points = _annual_points(gaap[tag], _DURATION, unit=unit)
            if not points:
                continue
            for year, val in points.items():
                merged.setdefault(year, val)
            # Use only the first tag that has data — do not mix diluted and
            # basic share counts across years (diluted > basic, so blending
            # across tag boundaries produces spurious dilution signals).
            break
        out[name] = [{"year": y, "value": merged[y]} for y in sorted(merged)]

    return out


def summarize_filings(submissions: dict) -> dict:
    """Company profile + filing history stats from the submissions index."""
    recent = submissions.get("filings", {}).get("recent", {})
    forms = recent.get("form", [])
    dates = recent.get("filingDate", [])

    counts: dict[str, int] = {}
    for f in forms:
        counts[f] = counts.get(f, 0) + 1

    # `recent` holds the latest ~1000 filings; older ones live in paged
    # files. The earliest date here is still a good "active since" signal,
    # and we surface total counts from what's available.
    first_filing = min(dates) if dates else None
    last_filing = max(dates) if dates else None

    return {
        "name": submissions.get("name"),
        "cik": submissions.get("cik"),
        "sic_description": submissions.get("sicDescription"),
        "exchanges": submissions.get("exchanges", []),
        "state_of_incorporation": submissions.get("stateOfIncorporation"),
        "fiscal_year_end": submissions.get("fiscalYearEnd"),
        "first_filing_date": first_filing,
        "last_filing_date": last_filing,
        "filings_indexed": len(forms),
        "form_counts": {
            "10-K": counts.get("10-K", 0),
            "10-Q": counts.get("10-Q", 0),
            "8-K": counts.get("8-K", 0),
            "DEF 14A": counts.get("DEF 14A", 0),
        },
    }
