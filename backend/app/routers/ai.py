import asyncio
import json
import logging
from datetime import date as date_type, datetime, timedelta, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app import models, auth
from app.database import get_db
from app.routers.portfolio import _get_or_create_portfolio
from app.services import ai_guard, market_data, claude

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/ai", tags=["ai"])


def _ai_error_to_http(exc: Exception):
    if isinstance(exc, claude.AINotConfigured):
        raise HTTPException(503, "AI features are not configured on this server.")
    # Subclass check first — AIRateLimited IS an AIRequestError. A provider
    # rate limit that survives the client's retry budget becomes an honest
    # 429 with Retry-After so the frontend can back off and retry, instead
    # of the opaque 502 that used to break long analyst reports.
    if isinstance(exc, claude.AIRateLimited):
        raise HTTPException(
            429,
            "The AI service is busy right now. Please try again in a moment.",
            headers={"Retry-After": str(exc.retry_after)},
        )
    if isinstance(exc, claude.AIRequestError):
        raise HTTPException(502, "AI request failed. Please try again.")
    raise exc


def _ai_user(
    current_user: models.User = Depends(auth.get_current_user),
) -> models.User:
    """Auth + per-user daily AI budget, composed as one dependency.

    The per-IP minute limiter in middleware.py stops bursts, but one account
    rotating IPs (or spread across devices) could still drain the shared
    Groq free-tier budget for everyone. This caps total AI calls per user
    per UTC day.
    """
    if not ai_guard.daily_quota.check_and_increment(current_user.id):
        raise HTTPException(
            429,
            "Daily AI usage limit reached. Your quota resets at midnight UTC.",
            headers={"Retry-After": "3600"},
        )
    return current_user


async def _user_holdings(current_user: models.User, db: Session) -> list[dict]:
    portfolio = _get_or_create_portfolio(current_user, db)
    if not portfolio.items:
        return []
    item_dicts = [
        {"ticker": i.ticker, "shares": i.shares, "avg_buy_price": i.avg_buy_price}
        for i in portfolio.items
    ]
    return await market_data.get_portfolio_analytics(item_dicts)


# ─────────────────────────────────────────────────────────────────────────
# 4.1 — Dashboard Daily Brief
# ─────────────────────────────────────────────────────────────────────────

@router.get("/daily-brief")
async def daily_brief(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(_ai_user),
):
    holdings = await _user_holdings(current_user, db)

    total_value = sum(h["value"] for h in holdings)
    total_cost = sum(h["cost"] for h in holdings)
    total_pnl_pct = ((total_value - total_cost) / total_cost * 100) if total_cost else 0.0

    indices, market_update = await asyncio.gather(
        market_data.get_market_indices(),
        market_data.get_market_update(),
    )
    index_lines = "\n".join(
        f"- {idx['ticker']}: {'+' if idx['change_pct'] >= 0 else ''}{idx['change_pct']:.2f}%"
        for idx in indices
    )
    top_sectors = sorted(market_update.get("sectors", []), key=lambda s: abs(s["change_pct"]), reverse=True)[:3]
    sector_lines = "\n".join(
        f"- {s['name']}: {'+' if s['change_pct'] >= 0 else ''}{s['change_pct']:.2f}%"
        for s in top_sectors
    )

    holdings_lines = "\n".join(
        f"- {h['ticker']} ({h['name']}): {h['shares']} sh, ${h['value']:,.2f} value, "
        f"P&L {'+' if h['pnl'] >= 0 else ''}{h['pnl_pct']:.2f}%"
        for h in holdings
    ) or "(no holdings yet)"

    # Upcoming earnings (next 7 days) for held tickers.
    held_tickers = {h["ticker"] for h in holdings}
    earnings_lines = []
    if held_tickers:
        today = date_type.today()
        for week_offset in (0, 1):
            cal = await market_data.get_earnings_calendar(week_offset)
            for day in cal.get("days", {}).values():
                day_date = date_type.fromisoformat(day["date"])
                if 0 <= (day_date - today).days <= 7:
                    for comp in day["companies"]:
                        if comp["ticker"] in held_tickers:
                            earnings_lines.append(
                                f"- {comp['ticker']} ({comp['name']}) reports {comp['time']} on "
                                f"{day['date']}: EPS est ${comp['eps_estimate']:.2f} vs "
                                f"${comp['eps_actual_prev']:.2f} last quarter, beat history {comp['beat_history']}"
                            )

    prompt = f"""Today's market conditions:
{index_lines or '(no index data)'}

Top sector movers:
{sector_lines or '(no sector data)'}

User's portfolio holdings:
{holdings_lines}
Total portfolio value: ${total_value:,.2f}
Overall return since first buy: {'+' if total_pnl_pct >= 0 else ''}{total_pnl_pct:.2f}%

Upcoming earnings (next 7 days) for held tickers:
{chr(10).join(earnings_lines) or '(none)'}

Write a 3-5 sentence daily brief in plain English, in this order:
1. One sentence market summary.
2. One sentence on how the user's portfolio is performing relative to the market.
3. One to two sentences on one specific thing to pay attention to today (an earnings report, catalyst, or volatility). If there are no holdings or earnings, point out a notable market mover instead.
4. One optional sentence suggesting something concrete (diversification or rebalancing).
Do not use markdown, headers, or bullet points — write flowing prose. Do not pad with disclaimers."""

    try:
        brief = await claude.ask_claude_text(
            system="You are a sharp, concise financial co-pilot writing a daily portfolio briefing for a retail investor. Be specific and use the real numbers given to you.",
            prompt=prompt,
            max_tokens=400,
        )
    except Exception as exc:
        _ai_error_to_http(exc)

    return {"brief": brief, "generated_at": datetime.now(timezone.utc).isoformat()}


# ─────────────────────────────────────────────────────────────────────────
# 4.2 — Contextual chart analysis
# ─────────────────────────────────────────────────────────────────────────

class ChartBar(BaseModel):
    c: float = Field(..., description="close")
    h: float | None = None
    l: float | None = None
    v: float | None = None


class NewsHeadline(BaseModel):
    # Headlines come from the frontend, which got them from a third-party
    # feed — treat them as untrusted twice over. A typed model (was
    # list[dict[str, Any]]) means only the title ever reaches the prompt,
    # bounded and fenced as data below.
    title: str = Field(default="", max_length=300)

    class Config:
        extra = "ignore"


class ChartAnalysisRequest(BaseModel):
    ticker: str = Field(..., max_length=10, pattern=r"^[A-Za-z0-9.\-^=]{1,10}$")
    range: str = Field(..., max_length=5, pattern=r"^[A-Za-z0-9]{1,5}$")
    price: float = Field(..., ge=0, le=10_000_000)
    change_pct: float = Field(..., ge=-100_000, le=100_000)
    bars: list[ChartBar] = Field(default_factory=list, max_length=2000)
    news: list[NewsHeadline] = Field(default_factory=list, max_length=10)


@router.post("/chart-analysis")
async def chart_analysis(
    body: ChartAnalysisRequest,
    # Every other /ai/* route requires auth; this one was anonymous, letting
    # any unauthenticated caller burn paid Claude API budget.
    current_user: models.User = Depends(_ai_user),
):
    closes = [b.c for b in body.bars if b.c is not None]
    highs = [b.h for b in body.bars if b.h is not None] or closes
    lows = [b.l for b in body.bars if b.l is not None] or closes
    volumes = [b.v for b in body.bars if b.v is not None]

    period_high = max(highs) if highs else body.price
    period_low = min(lows) if lows else body.price

    trend = "flat"
    if len(closes) >= 2:
        delta_pct = (closes[-1] - closes[0]) / closes[0] * 100 if closes[0] else 0
        if delta_pct > 2:
            trend = "uptrend"
        elif delta_pct < -2:
            trend = "downtrend"

    volume_note = "no volume data"
    if len(volumes) >= 5:
        recent_avg = sum(volumes[-5:]) / 5
        prior_avg = sum(volumes[:-5]) / len(volumes[:-5]) if len(volumes) > 5 else recent_avg
        if prior_avg:
            ratio = recent_avg / prior_avg
            if ratio > 1.3:
                volume_note = "recent volume is notably above its prior average"
            elif ratio < 0.7:
                volume_note = "recent volume is notably below its prior average"
            else:
                volume_note = "volume is in line with its recent average"

    # Fence the third-party headlines as inert data (see ai_guard.PROMPT_GUARD)
    # so a malicious headline can't inject instructions into the prompt.
    titles = "\n".join(
        f"- {ai_guard.sanitize_text(n.title, max_len=300)}" for n in body.news[:5] if n.title
    )
    news_lines = ai_guard.wrap_untrusted("recent headlines", titles) if titles else "(no recent headlines)"

    prompt = f"""Ticker: {body.ticker}
Current price: ${body.price:.2f} ({'+' if body.change_pct >= 0 else ''}{body.change_pct:.2f}% today)
Time range shown: {body.range}
Period high: ${period_high:.2f}
Period low: ${period_low:.2f}
Trend over this period: {trend}
Volume: {volume_note}

Recent headlines:
{news_lines}

Write a chart analysis for a normal investor (no technical jargon, explain plainly). Cover, in flowing prose (no markdown/headers):
1. A plain-English reading of the price pattern over this time range.
2. Approximate support and resistance levels (you can reference the period high/low given).
3. Whether the stock looks extended, oversold, or neutral right now, and why.
4. How the recent news headlines (if any) relate to the price action.
Keep it under 150 words."""

    try:
        analysis = await claude.ask_claude_text(
            system="You are a financial co-pilot explaining stock charts in plain English to a non-technical retail investor. Never give direct buy/sell instructions.",
            prompt=prompt,
            max_tokens=500,
        )
    except Exception as exc:
        _ai_error_to_http(exc)

    return {
        "analysis": analysis,
        "period_high": round(period_high, 2),
        "period_low": round(period_low, 2),
        "trend": trend,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "disclaimer": "This is AI-generated analysis, not financial advice.",
    }


# ─────────────────────────────────────────────────────────────────────────
# 4.3 — AI earnings briefing (cached per ticker + earnings date)
# ─────────────────────────────────────────────────────────────────────────

class EarningsBriefRequest(BaseModel):
    # The generated brief is cached globally per ticker+date and served to
    # every user, so these client-supplied fields are locked to strict
    # shapes — free-form text here was a prompt-injection / shared-cache
    # poisoning vector.
    ticker: str = Field(..., max_length=10, pattern=r"^[A-Za-z0-9.\-]{1,10}$")
    name: str = Field(..., max_length=100, pattern=r"^[\w .,&'()\-]{1,100}$")
    earnings_date: str = Field(..., pattern=r"^\d{4}-\d{2}-\d{2}$")
    time: str = Field(..., pattern=r"^(AMC|BMO)$")
    eps_estimate: float = Field(..., ge=-100_000, le=100_000)
    eps_actual_prev: float = Field(..., ge=-100_000, le=100_000)
    beat_history: str = Field(..., pattern=r"^[0-9]/[0-9]$")


# The exact shape an earnings brief must have before it may be cached and
# served to every user. Anything else (truncated JSON, model refusal,
# hallucinated keys) is served once, uncached, and regenerated next time.
_EARNINGS_BRIEF_KEYS = {
    "analysts_expect": 1000,
    "key_things_to_watch": 1000,
    "historical_behavior": 600,
}


@router.post("/earnings-brief")
async def earnings_brief(
    body: EarningsBriefRequest,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(_ai_user),
):
    cached = (
        db.query(models.AIEarningsBrief)
        .filter(
            models.AIEarningsBrief.ticker == body.ticker.upper(),
            models.AIEarningsBrief.earnings_date == body.earnings_date,
        )
        .first()
    )

    if cached:
        brief = json.loads(cached.brief_json)
        from_cache = True
    else:
        prompt = f"""Company: {body.name} ({body.ticker})
Reports earnings: {body.earnings_date} ({body.time})
Consensus EPS estimate: ${body.eps_estimate:.2f}
Last quarter actual EPS: ${body.eps_actual_prev:.2f}
Historical beat/miss record (last 4 quarters): {body.beat_history}

Write a pre-earnings brief for a retail investor. Respond in pure JSON (no markdown fences):
{{
  "analysts_expect": "1-2 sentences on what analysts expect this quarter and why",
  "key_things_to_watch": "1-2 sentences on what to watch in the report (margins, guidance, etc.)",
  "historical_behavior": "1 sentence on how the stock has historically moved after earnings, given the beat/miss record"
}}"""
        try:
            text = await claude.ask_claude_text(
                system="You are a financial co-pilot writing pre-earnings briefs for retail investors. Always respond with pure JSON.",
                prompt=prompt,
                max_tokens=500,
            )
        except Exception as exc:
            _ai_error_to_http(exc)

        if text.startswith("```"):
            text = text.split("\n", 1)[1].rsplit("```", 1)[0].strip()
        try:
            parsed = json.loads(text)
        except json.JSONDecodeError:
            parsed = None

        # Only a brief that matches the expected shape may enter the shared
        # cache — a malformed generation used to be cached forever and served
        # to every user who opened that earnings card.
        brief = ai_guard.validate_ai_fields(
            parsed, _EARNINGS_BRIEF_KEYS, require_all=True
        )
        if brief is not None:
            db.add(models.AIEarningsBrief(
                ticker=body.ticker.upper(),
                earnings_date=body.earnings_date,
                brief_json=json.dumps(brief),
            ))
            db.commit()
        else:
            brief = {"raw": ai_guard.sanitize_text(text, max_len=3000)}
        from_cache = False

    # Per-user position note — computed locally (deterministic, not cached/AI).
    portfolio = _get_or_create_portfolio(current_user, db)
    held = next((i for i in portfolio.items if i.ticker == body.ticker.upper()), None)
    position_note = None
    if held:
        position_note = (
            f"You hold {held.shares:g} shares of {body.ticker} (avg cost ${held.avg_buy_price:.2f}). "
            f"A 5% earnings-driven move would shift this position by roughly "
            f"${held.shares * held.avg_buy_price * 0.05:,.2f}."
        )

    return {**brief, "position_note": position_note, "from_cache": from_cache}


# ─────────────────────────────────────────────────────────────────────────
# 4.4 — App-wide conversational assistant
# ─────────────────────────────────────────────────────────────────────────

class ChatMessage(BaseModel):
    role: str = Field(..., pattern=r"^(user|assistant)$")
    content: str = Field(..., max_length=4000)


class ChatRequest(BaseModel):
    message: str = Field(..., max_length=2000)
    history: list[ChatMessage] = Field(default_factory=list, max_length=40)
    current_page: str = Field(default="", max_length=100)


@router.post("/chat")
async def chat(
    body: ChatRequest,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(_ai_user),
):
    holdings = await _user_holdings(current_user, db)
    holdings_lines = "\n".join(
        f"- {h['ticker']}: {h['shares']} sh, ${h['value']:,.2f} value, "
        f"P&L {'+' if h['pnl'] >= 0 else ''}{h['pnl_pct']:.2f}%, beta {h['beta']}"
        for h in holdings
    ) or "(no holdings)"

    watchlist = (
        db.query(models.Watchlist).filter(models.Watchlist.user_id == current_user.id).all()
    )
    watchlist_line = ", ".join(w.ticker for w in watchlist) or "(empty)"

    indices = await market_data.get_market_indices()
    index_lines = "\n".join(
        f"- {idx['ticker']}: {'+' if idx['change_pct'] >= 0 else ''}{idx['change_pct']:.2f}%"
        for idx in indices
    )

    system = f"""You are the in-app financial co-pilot for MarketCap, a portfolio tracking app. Answer the user's question conversationally and concisely. Use their real portfolio data below when relevant. Never give definitive buy/sell instructions — frame things as analysis and education, not advice. If asked about something outside investing/finance, gently redirect.

User's portfolio holdings:
{holdings_lines}

User's watchlist: {watchlist_line}

Today's market indices:
{index_lines or '(unavailable)'}

User is currently viewing: {ai_guard.sanitize_text(body.current_page, max_len=100) or 'unknown page'}"""

    # Bound the history to a character budget: 40 messages x 4,000 chars
    # passes validation but far exceeds the Groq per-minute token limit, so
    # long chat sessions were guaranteed to start failing. Newest-first
    # trimming keeps the conversation working forever.
    messages = ai_guard.trim_history(
        [{"role": m.role, "content": m.content} for m in body.history]
    )
    messages.append({"role": "user", "content": ai_guard.sanitize_text(body.message, max_len=2000)})

    try:
        reply = await claude.ask_claude(system, messages, max_tokens=700)
    except Exception as exc:
        _ai_error_to_http(exc)

    return {"reply": reply}


# ─────────────────────────────────────────────────────────────────────────
# 4.5 — Analyst Report
# ─────────────────────────────────────────────────────────────────────────

class AnalystReportRequest(BaseModel):
    ticker: str = Field(..., max_length=10, pattern=r"^[A-Za-z0-9.\-]{1,10}$")
    timespan: str = Field(default="1Y", pattern=r"^(1M|6M|1Y|5Y)$")
    depth: str = Field(default="standard", pattern=r"^(brief|standard|deep)$")


# Report length is expressed to the model as countable printed pages
# (~500 words per page), so each depth lands inside its advertised page
# range and never past its ceiling. Brief runs on the fast default model;
# standard and deep are AI-written long-form research, so both route to the
# deep model tier (claude.py: largest reasoning model, high reasoning
# effort, extended timeout). Deep dive is deliberately budgeted far above
# every other choice — one generation per major section instead of grouped
# sections, with several times the per-section word target.
_DEPTH_CONFIG = {
    "brief": {
        "pages": (1, 3),
        "instruction": (
            "Total report length: 1-3 printed pages (roughly 500-1,500 words across the whole "
            "report, at ~500 words per page). Write 1-3 tight sentences per section — key "
            "takeaway only. Never exceed 3 pages."
        ),
        "max_tokens": 2000,
        "tier": "default",
        "section_groups": None,  # single generation
    },
    "standard": {
        "pages": (10, 15),
        "instruction": (
            "Total report length: 10-15 printed pages (roughly 5,000-7,500 words across the "
            "whole report, at ~500 words per page). Write 2-4 substantial paragraphs "
            "(roughly 550-800 words) per major section, with supporting data points drawn "
            "from the figures provided. Never exceed 15 pages."
        ),
        "max_tokens": 3400,  # per chunk × 3 chunks
        "tier": "deep",
        "section_groups": [
            ["investment_thesis", "rating", "company_overview"],
            ["financial_analysis", "valuation_assessment", "balance_sheet_health"],
            ["analyst_consensus", "growth_outlook", "risk_factors", "arr_mrr_note"],
        ],
    },
    "deep": {
        "pages": (35, 45),
        "instruction": (
            "Total report length: 35-45 printed pages (roughly 17,500-22,500 words across the "
            "whole report, at ~500 words per page) — this is the deep-dive tier and must carry "
            "far more information than any other report depth. Write 6-10 detailed paragraphs "
            "(roughly 1,900-2,400 words) per major section. Include peer comparisons, "
            "historical context, granular segment analysis, scenario modeling (bull / base / "
            "bear), and DCF sensitivity discussion where applicable. Add sub-sections for "
            "competitive landscape and segment breakdown. Never exceed 45 pages."
        ),
        "max_tokens": 6000,  # per chunk × 9 chunks; headroom for reasoning tokens
        "tier": "deep",
        "section_groups": [
            ["investment_thesis", "rating"],
            ["company_overview"],
            ["financial_analysis"],
            ["valuation_assessment"],
            ["balance_sheet_health"],
            ["analyst_consensus"],
            ["growth_outlook"],
            ["risk_factors"],
            ["arr_mrr_note"],
        ],
    },
}

# Whitelist + max length for every narrative field the frontend knows how to
# render. Model output is validated against this before it leaves the server,
# so a hallucinated or injected key can never reach the client. Caps are sized
# for deep-dive output (~2,400 words ≈ 15K chars per section, plus headroom).
_NARRATIVE_KEYS = {
    "investment_thesis": 20000,
    "rating": 40,
    "company_overview": 24000,
    "financial_analysis": 24000,
    "valuation_assessment": 24000,
    "balance_sheet_health": 24000,
    "analyst_consensus": 24000,
    "growth_outlook": 24000,
    "risk_factors": 24000,
    "arr_mrr_note": 12000,
}


def _fmt_num(v, prefix="", suffix="", pct=False):
    if v is None:
        return "N/A"
    if pct:
        return f"{v * 100:.1f}%"
    if abs(v) >= 1e12:
        return f"{prefix}{v / 1e12:.2f}T{suffix}"
    if abs(v) >= 1e9:
        return f"{prefix}{v / 1e9:.2f}B{suffix}"
    if abs(v) >= 1e6:
        return f"{prefix}{v / 1e6:.1f}M{suffix}"
    return f"{prefix}{v:,.2f}{suffix}"


@router.post("/analyst-report")
async def analyst_report(
    body: AnalystReportRequest,
    current_user: models.User = Depends(_ai_user),
):
    ticker = body.ticker.upper().strip()
    data = await market_data.get_analyst_report_data(ticker, body.timespan)

    co = data["company"]
    q = data["quote"]
    m = data["margins"]
    v = data["valuation"]
    g = data["growth"]
    h = data["health"]
    at = data["analyst_targets"]

    depth_cfg = _DEPTH_CONFIG[body.depth]

    revenue_summary = ", ".join(
        f"{r['year']}: {_fmt_num(r['value'], prefix='$')}"
        for r in data["financials"]["annual_revenue"]
    ) or "N/A"
    net_income_summary = ", ".join(
        f"{r['year']}: {_fmt_num(r['value'], prefix='$')}"
        for r in data["financials"]["annual_net_income"]
    ) or "N/A"

    # Data context shared by all depths. Kept separate from the output-format
    # instruction so deep-mode chunks can append their own narrower schema
    # without the model seeing two conflicting "return these keys" directives.
    data_context = f"""Company: {co['name']} ({ticker})
Sector: {co['sector']} | Industry: {co['industry']}
Employees: {co['employees'] or 'N/A'}

Current Price: ${q['price']} ({'+' if q['change_pct'] >= 0 else ''}{q['change_pct']}% today)
Market Cap: {_fmt_num(co['market_cap'], prefix='$')}
52-Week Range: ${at.get('low') or q.get('week_52_low') or 'N/A'} – ${at.get('high') or q.get('week_52_high') or 'N/A'}

Margins: Gross {_fmt_num(m['gross'], pct=True)}, Operating {_fmt_num(m['operating'], pct=True)}, Net {_fmt_num(m['profit'], pct=True)}, EBITDA {_fmt_num(m['ebitda'], pct=True)}

Annual Revenue (last 4 years): {revenue_summary}
Annual Net Income (last 4 years): {net_income_summary}

Growth: Revenue {_fmt_num(g['revenue_growth'], pct=True)}, Earnings {_fmt_num(g['earnings_growth'], pct=True)}

Valuation: P/E {v['pe'] or 'N/A'}, Forward P/E {v['forward_pe'] or 'N/A'}, P/S {v['ps'] or 'N/A'}, P/B {v['pb'] or 'N/A'}, EV/Revenue {v['ev_to_revenue'] or 'N/A'}, EV/EBITDA {v['ev_to_ebitda'] or 'N/A'}
Enterprise Value: {_fmt_num(v['enterprise_value'], prefix='$')}

Balance Sheet: Debt/Equity {h['debt_to_equity'] or 'N/A'}, Current Ratio {h['current_ratio'] or 'N/A'}, ROE {_fmt_num(h['roe'], pct=True)}, ROA {_fmt_num(h['roa'], pct=True)}
Free Cash Flow: {_fmt_num(h['fcf'], prefix='$')}
Total Debt: {_fmt_num(h['total_debt'], prefix='$')}

Analyst Consensus: {at['recommendation'] or 'N/A'} (score {at['score'] or 'N/A'}/5)
Price Targets: Low ${at['low'] or 'N/A'}, Mean ${at['mean'] or 'N/A'}, Median ${at['median'] or 'N/A'}, High ${at['high'] or 'N/A'}
Number of Analysts: {at['num_analysts'] or 'N/A'}

Company Description: {ai_guard.wrap_untrusted("company description from data provider", co['description'][:2000]) if co['description'] else 'N/A'}

Time span analyzed: {body.timespan}
Report depth: {body.depth}
Length instructions: {depth_cfg['instruction']}"""

    prompt = data_context + """

Respond in pure JSON (no markdown fences). Return exactly these keys:
{
  "investment_thesis": "...",
  "rating": "Buy" or "Hold" or "Sell",
  "company_overview": "...",
  "financial_analysis": "...",
  "valuation_assessment": "...",
  "balance_sheet_health": "...",
  "analyst_consensus": "...",
  "growth_outlook": "...",
  "risk_factors": "...",
  "arr_mrr_note": "... or null if not a SaaS/subscription business"
}"""

    system = (
        "You are a senior equity research analyst at a top-tier investment bank. "
        "Produce an institutional-grade analyst report following the CFA Institute standard. "
        "Use the Pyramid Principle: lead each section with the key conclusion, then supporting evidence. "
        "Be specific with numbers — reference the actual data provided. "
        "Never give disclaimers about not being financial advice inside the narrative — "
        "that is handled separately. Always respond with pure JSON."
    )

    def _parse_ai_json(text: str) -> dict:
        if text.startswith("```"):
            text = text.split("\n", 1)[1].rsplit("```", 1)[0].strip()
        return json.loads(text)

    if depth_cfg["section_groups"]:
        # Chunked long-form generation (standard + deep dive): one deep-tier
        # model call per section group, so the total output can reach the
        # depth's page budget without any single generation blowing the
        # provider's per-request output limit.
        raw_narrative: dict[str, Any] = {}
        for group in depth_cfg["section_groups"]:
            keys_json = ", ".join(f'"{k}": "..."' for k in group)
            # Use data_context (not the full prompt) so the chunk instruction is
            # the only output-format directive the model sees — avoids a
            # contradiction where the model is told to return all 10 keys and
            # then immediately told to return only 3-4.
            chunk_prompt = (
                f"{data_context}\n\n"
                f"Respond in pure JSON (no markdown fences). "
                f"Generate ONLY these sections: {', '.join(group)}.\n"
                f"Return exactly these keys:\n{{{keys_json}}}"
            )
            try:
                text = await claude.ask_claude_text(
                    system,
                    chunk_prompt,
                    max_tokens=depth_cfg["max_tokens"],
                    tier=depth_cfg["tier"],
                )
            except Exception as exc:
                _ai_error_to_http(exc)
            try:
                chunk = _parse_ai_json(text)
                raw_narrative.update(chunk)
            except json.JSONDecodeError:
                raw_narrative.update({key: None for key in group})
        narrative = ai_guard.validate_ai_fields(raw_narrative, _NARRATIVE_KEYS) or {}
    else:
        try:
            text = await claude.ask_claude_text(
                system,
                prompt,
                max_tokens=depth_cfg["max_tokens"],
                tier=depth_cfg["tier"],
            )
        except Exception as exc:
            _ai_error_to_http(exc)
        try:
            # Whitelist the parsed keys so only fields the UI knows how to
            # render — at bounded lengths — ever reach the client.
            narrative = ai_guard.validate_ai_fields(_parse_ai_json(text), _NARRATIVE_KEYS) or {}
        except json.JSONDecodeError:
            narrative = {"raw": ai_guard.sanitize_text(text, max_len=40_000)}

    # The rating drives a colour-coded badge in a trusted-looking UI element;
    # constrain it to the three values the frontend understands.
    if "rating" in narrative:
        narrative["rating"] = ai_guard.normalize_rating(narrative.get("rating"))

    return {
        **data,
        "narrative": narrative,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "timespan": body.timespan,
        "depth": body.depth,
        "target_pages": "{}-{}".format(*depth_cfg["pages"]),
        "disclaimer": "AI-generated analysis for informational purposes only. Not financial advice.",
    }
