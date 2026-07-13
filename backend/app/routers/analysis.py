"""
Autonomous company-life analysis — no AI models involved.

Pulls every financial document the company has filed with the SEC (via the
EDGAR XBRL APIs), reads the full annual-report history, and runs it through
the deterministic analysis engine to produce a written report with insights,
growth phases, health scores, and chart-ready series covering the company's
entire reported life.
"""
import asyncio
import logging
import re
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException

from app import models, auth
from app.services import analysis_engine, edgar, market_data

router = APIRouter(prefix="/analysis", tags=["analysis"])
logger = logging.getLogger(__name__)

_TICKER_RE = re.compile(r"^[A-Z0-9.\-]{1,10}$")


@router.get("/company/{ticker}")
async def company_life_analysis(
    ticker: str,
    current_user: models.User = Depends(auth.get_current_user),
):
    t = ticker.upper().strip()
    if not _TICKER_RE.match(t):
        raise HTTPException(400, "Invalid ticker symbol.")

    cik = await edgar.get_cik(t)
    if cik is None:
        raise HTTPException(
            404,
            "No SEC filings found for this ticker. The document-analysis engine "
            "covers U.S.-listed SEC registrants only.",
        )

    # Fetch the filing index, all XBRL facts, and lifetime market data in
    # parallel. EDGAR failures are fatal (the report is built from filings);
    # market data is best-effort — the fundamental analysis still stands
    # without it.
    facts_task = edgar.get_company_facts(cik)
    subs_task = edgar.get_submissions(cik)
    price_task = market_data.get_price_life(t)
    facts, subs, price = await asyncio.gather(
        facts_task, subs_task, price_task, return_exceptions=True
    )

    if isinstance(facts, BaseException) or isinstance(subs, BaseException):
        logger.warning("EDGAR fetch failed for %s (cik=%s): %s / %s", t, cik,
                       facts if isinstance(facts, BaseException) else "ok",
                       subs if isinstance(subs, BaseException) else "ok")
        raise HTTPException(502, "SEC EDGAR is unavailable right now — try again shortly.")
    if isinstance(price, BaseException):
        logger.warning("price-life fetch failed for %s: %s", t, price)
        price = {"bars": [], "dividends_by_year": [], "splits": [], "market_cap": None}

    profile = edgar.summarize_filings(subs)
    series = edgar.extract_annual_series(facts)

    if not series.get("revenue") and not series.get("net_income"):
        raise HTTPException(
            404,
            "This registrant has no machine-readable annual financials on EDGAR "
            "(XBRL data generally starts in 2009).",
        )

    phases = analysis_engine.segment_growth_phases(series.get("revenue", []))
    ratios = analysis_engine.build_ratio_table(series)
    f_score = analysis_engine.piotroski_f_score(series)
    z_score = analysis_engine.altman_z_score(series, price.get("market_cap"))
    story = analysis_engine.price_story(
        price.get("bars", []), price.get("dividends_by_year", []), price.get("splits", [])
    )
    insights = analysis_engine.generate_insights(
        profile, series, phases, ratios, f_score, z_score, story
    )

    # Derive FCF series for charting (OCF − |capex|)
    capex = {p["year"]: p["value"] for p in series.get("capex", [])}
    fcf = [
        {"year": p["year"], "value": p["value"] - abs(capex[p["year"]])}
        for p in series.get("ocf", []) if p["year"] in capex
    ]

    return {
        "ticker": t,
        "profile": profile,
        "series": {**series, "fcf": fcf},
        "phases": phases,
        "ratios_by_year": ratios,
        "scores": {"piotroski": f_score, "altman": z_score},
        "price_story": story,
        "price_bars": price.get("bars", []),
        "insights": insights,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "methodology": (
            "Deterministic analysis of SEC EDGAR XBRL filings (10-K annual reports) "
            "and lifetime market data. All figures computed by formula; all findings "
            "rule-generated. No AI model was used."
        ),
        "sources": ["SEC EDGAR (data.sec.gov)", "Yahoo Finance"],
    }
