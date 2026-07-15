"""
Deterministic company-analysis engine.

Takes the full-history financial series extracted from SEC filings (edgar.py)
plus lifetime market data, and produces the same outputs an analyst would —
growth-phase segmentation, ratio trajectories, Piotroski F-Score, Altman
Z-Score, cash-flow quality, drawdown analysis — together with written,
rule-generated insight sentences. No AI model is involved anywhere in this
module: every number is a formula and every sentence is a template driven by
the data, so results are reproducible and auditable.
"""
from __future__ import annotations

import logging

logger = logging.getLogger(__name__)

Series = list[dict]  # [{"year": int, "value": float}, ...] sorted ascending


# ── helpers ────────────────────────────────────────────────────────────────

def _as_map(s: Series) -> dict[int, float]:
    return {p["year"]: p["value"] for p in (s or [])}


def _fmt_money(v: float | None) -> str:
    if v is None:
        return "N/A"
    neg = v < 0
    a = abs(v)
    if a >= 1e12:
        s = f"${a / 1e12:.2f} trillion"
    elif a >= 1e9:
        s = f"${a / 1e9:.2f} billion"
    elif a >= 1e6:
        s = f"${a / 1e6:.1f} million"
    else:
        s = f"${a:,.0f}"
    return f"-{s}" if neg else s


def _cagr(first: float, last: float, years: int) -> float | None:
    if years <= 0 or first is None or last is None or first <= 0 or last <= 0:
        return None
    return ((last / first) ** (1 / years) - 1) * 100


# ── growth-phase segmentation ──────────────────────────────────────────────

_PHASE_LABELS = [
    (25.0, "Hypergrowth"),
    (10.0, "Rapid growth"),
    (3.0, "Steady growth"),
    (-3.0, "Plateau"),
    (float("-inf"), "Decline"),
]


def _classify_growth(pct: float) -> str:
    for threshold, label in _PHASE_LABELS:
        if pct >= threshold:
            return label
    return "Decline"


def segment_growth_phases(revenue: Series) -> list[dict]:
    """Split the revenue history into contiguous phases of similar growth.
    This is the 'life story' skeleton: e.g. Hypergrowth 2004-2012 →
    Steady growth 2013-2019 → Plateau 2020-2024."""
    if len(revenue) < 3:
        return []
    years = [p["year"] for p in revenue]
    vals = [p["value"] for p in revenue]

    yoy: list[tuple[int, float]] = []
    for i in range(1, len(vals)):
        if vals[i - 1] and vals[i - 1] > 0:
            yoy.append((years[i], (vals[i] / vals[i - 1] - 1) * 100))

    if not yoy:
        return []

    phases: list[dict] = []
    cur_label = _classify_growth(yoy[0][1])
    start = yoy[0][0]
    rates = [yoy[0][1]]
    for year, rate in yoy[1:]:
        label = _classify_growth(rate)
        if label == cur_label:
            rates.append(rate)
        else:
            phases.append({"start_year": start, "end_year": year - 1,
                           "label": cur_label, "avg_growth_pct": round(sum(rates) / len(rates), 1)})
            cur_label, start, rates = label, year, [rate]
    phases.append({"start_year": start, "end_year": yoy[-1][0],
                   "label": cur_label, "avg_growth_pct": round(sum(rates) / len(rates), 1)})

    # Merge 1-year blips into surrounding phases to avoid noise
    merged: list[dict] = []
    for ph in phases:
        if (merged and ph["start_year"] == ph["end_year"]
                and merged[-1]["label"] != "Decline" and ph["label"] != "Decline"):
            prev = merged[-1]
            n_prev = max(prev["end_year"] - prev["start_year"], 1)
            prev["avg_growth_pct"] = round(
                (prev["avg_growth_pct"] * n_prev + ph["avg_growth_pct"]) / (n_prev + 1), 1
            )
            prev["end_year"] = ph["end_year"]
        else:
            merged.append(ph)
    return merged


# ── ratio table ────────────────────────────────────────────────────────────

def build_ratio_table(series: dict[str, Series]) -> list[dict]:
    """Per-year fundamental ratios across the company's whole reported life."""
    rev = _as_map(series.get("revenue", []))
    gp = _as_map(series.get("gross_profit", []))
    op = _as_map(series.get("operating_income", []))
    ni = _as_map(series.get("net_income", []))
    assets = _as_map(series.get("assets", []))
    liab = _as_map(series.get("liabilities", []))
    eq = _as_map(series.get("equity", []))
    ca = _as_map(series.get("current_assets", []))
    cl = _as_map(series.get("current_liabilities", []))
    ocf = _as_map(series.get("ocf", []))

    years = sorted(set(rev) | set(ni))
    rows = []
    for y in years:
        r, n = rev.get(y), ni.get(y)
        row = {"year": y}
        row["gross_margin"] = round(gp[y] / r * 100, 1) if y in gp and r else None
        row["operating_margin"] = round(op[y] / r * 100, 1) if y in op and r else None
        row["net_margin"] = round(n / r * 100, 1) if n is not None and r else None
        row["roe"] = round(n / eq[y] * 100, 1) if n is not None and eq.get(y) else None
        row["roa"] = round(n / assets[y] * 100, 1) if n is not None and assets.get(y) else None
        row["debt_to_equity"] = round(liab[y] / eq[y], 2) if eq.get(y) and y in liab else None
        row["current_ratio"] = round(ca[y] / cl[y], 2) if cl.get(y) and y in ca else None
        row["ocf_to_ni"] = round(ocf[y] / n, 2) if y in ocf and n else None
        rows.append(row)
    return rows


# ── Piotroski F-Score ──────────────────────────────────────────────────────

def piotroski_f_score(series: dict[str, Series]) -> dict | None:
    """The 9-point fundamental strength checklist (Piotroski 2000), computed
    from the two most recent fiscal years of filed data."""
    ni = _as_map(series.get("net_income", []))
    assets = _as_map(series.get("assets", []))
    ocf = _as_map(series.get("ocf", []))
    ltd = _as_map(series.get("long_term_debt", []))
    ca = _as_map(series.get("current_assets", []))
    cl = _as_map(series.get("current_liabilities", []))
    gp = _as_map(series.get("gross_profit", []))
    rev = _as_map(series.get("revenue", []))
    shares = _as_map(series.get("shares", []))

    common = sorted(set(ni) & set(assets))
    if len(common) < 2:
        return None
    y, p = common[-1], common[-2]  # latest year, prior year

    def roa(yr):
        return ni[yr] / assets[yr] if assets.get(yr) else None

    checks: list[dict] = []

    def add(name: str, ok: bool | None, detail: str):
        checks.append({"name": name, "pass": bool(ok) if ok is not None else None, "detail": detail})

    r_y, r_p = roa(y), roa(p)
    add("Positive ROA", r_y is not None and r_y > 0,
        f"Return on assets of {r_y * 100:.1f}% in FY{y}" if r_y is not None else "Insufficient data")
    add("Positive operating cash flow", ocf.get(y, 0) > 0 if y in ocf else None,
        f"Operating cash flow of {_fmt_money(ocf.get(y))} in FY{y}" if y in ocf else "Insufficient data")
    add("Improving ROA", (r_y or 0) > (r_p or 0) if r_y is not None and r_p is not None else None,
        f"ROA moved from {r_p * 100:.1f}% to {r_y * 100:.1f}%" if r_y is not None and r_p is not None else "Insufficient data")
    if y in ocf and y in ni:
        _cf_ok = ocf[y] > ni[y]
        _cf_detail = "Earnings are backed by real cash (low accruals)" if _cf_ok else "Accruals exceed cash generation"
    else:
        _cf_ok, _cf_detail = None, "Insufficient data"
    add("Cash flow exceeds net income", _cf_ok, _cf_detail)

    if y in ltd and p in ltd and assets.get(y) and assets.get(p):
        lev_y, lev_p = ltd[y] / assets[y], ltd[p] / assets[p]
        add("Decreasing leverage", lev_y <= lev_p,
            f"Long-term debt/assets moved from {lev_p:.2f} to {lev_y:.2f}")
    else:
        add("Decreasing leverage", None, "Insufficient data")

    if all(k in ca and k in cl and cl[k] for k in (y, p)):
        cr_y, cr_p = ca[y] / cl[y], ca[p] / cl[p]
        add("Improving liquidity", cr_y > cr_p,
            f"Current ratio moved from {cr_p:.2f} to {cr_y:.2f}")
    else:
        add("Improving liquidity", None, "Insufficient data")

    if y in shares and p in shares and shares[p]:
        add("No shareholder dilution", shares[y] <= shares[p] * 1.02,
            f"Diluted shares moved from {shares[p] / 1e6:,.0f}M to {shares[y] / 1e6:,.0f}M")
    else:
        add("No shareholder dilution", None, "Insufficient data")

    if all(k in gp and k in rev and rev[k] for k in (y, p)):
        gm_y, gm_p = gp[y] / rev[y], gp[p] / rev[p]
        add("Expanding gross margin", gm_y > gm_p,
            f"Gross margin moved from {gm_p * 100:.1f}% to {gm_y * 100:.1f}%")
    else:
        add("Expanding gross margin", None, "Insufficient data")

    if all(k in rev and assets.get(k) for k in (y, p)):
        at_y, at_p = rev[y] / assets[y], rev[p] / assets[p]
        add("Improving asset turnover", at_y > at_p,
            f"Asset turnover moved from {at_p:.2f}x to {at_y:.2f}x")
    else:
        add("Improving asset turnover", None, "Insufficient data")

    score = sum(1 for c in checks if c["pass"])
    return {"score": score, "max_score": 9, "fiscal_year": y, "checks": checks}


# ── Altman Z-Score ─────────────────────────────────────────────────────────

def altman_z_score(series: dict[str, Series], market_cap: float | None) -> dict | None:
    """Classic Altman Z (1968): bankruptcy-risk composite from the latest
    filed balance sheet. Zones: >2.99 safe, 1.81-2.99 grey, <1.81 distress."""
    assets = _as_map(series.get("assets", []))
    liab = _as_map(series.get("liabilities", []))
    ca = _as_map(series.get("current_assets", []))
    cl = _as_map(series.get("current_liabilities", []))
    re = _as_map(series.get("retained_earnings", []))
    op = _as_map(series.get("operating_income", []))
    rev = _as_map(series.get("revenue", []))

    years = sorted(set(assets) & set(liab))
    if not years:
        return None
    y = years[-1]
    ta = assets[y]
    tl = liab[y]
    if not ta or not tl:
        return None

    comp = {}
    comp["working_capital_to_assets"] = ((ca.get(y, 0) - cl.get(y, 0)) / ta) if y in ca and y in cl else None
    comp["retained_earnings_to_assets"] = (re[y] / ta) if y in re else None
    comp["ebit_to_assets"] = (op[y] / ta) if y in op else None
    comp["market_value_to_liabilities"] = (market_cap / tl) if market_cap is not None else None
    comp["sales_to_assets"] = (rev[y] / ta) if y in rev else None

    weights = {
        "working_capital_to_assets": 1.2,
        "retained_earnings_to_assets": 1.4,
        "ebit_to_assets": 3.3,
        "market_value_to_liabilities": 0.6,
        "sales_to_assets": 1.0,
    }
    available = {k: v for k, v in comp.items() if v is not None}
    if len(available) < 3:
        return None
    z = sum(weights[k] * v for k, v in available.items())

    complete = len(available) == 5
    # Only classify zone against calibrated thresholds when all 5 components
    # are present — a partial sum produces a meaninglessly low score.
    zone = ("Safe" if z > 2.99 else ("Grey" if z >= 1.81 else "Distress")) if complete else "Incomplete"
    return {
        "score": round(z, 2),
        "zone": zone,
        "fiscal_year": y,
        "components": {k: round(v, 3) if v is not None else None for k, v in comp.items()},
        "complete": complete,
    }


# ── price / shareholder-return story ───────────────────────────────────────

def price_story(bars: list[dict], dividends_by_year: Series, splits: list[dict]) -> dict | None:
    """Lifetime market narrative: total return, CAGR, all-time high, max
    drawdown (peak→trough), split and dividend history."""
    if not bars:
        return None
    first, last = bars[0], bars[-1]
    years = max((last["t"] - first["t"]) / (365.25 * 24 * 3600 * 1000), 0.1)

    ath = max(bars, key=lambda b: b["c"])

    # Max drawdown: largest peak-to-trough fall across the whole history
    peak = bars[0]
    max_dd = 0.0
    dd_peak, dd_trough = bars[0], bars[0]
    for b in bars:
        if b["c"] > peak["c"]:
            peak = b
        if peak["c"] > 0:
            dd = (b["c"] - peak["c"]) / peak["c"] * 100
            if dd < max_dd:
                max_dd = dd
                dd_peak, dd_trough = peak, b

    total_return = ((last["c"] / first["c"]) - 1) * 100 if first["c"] else None
    return {
        "first_date": first["d"],
        "first_close": first["c"],
        "last_close": last["c"],
        "years_of_data": round(years, 1),
        "total_return_pct": round(total_return, 1) if total_return is not None else None,
        "cagr_pct": round(_cagr(first["c"], last["c"], int(years)) or 0, 1) if years >= 1 else None,
        "all_time_high": {"date": ath["d"], "price": ath["c"]},
        "max_drawdown": {
            "pct": round(max_dd, 1),
            "peak_date": dd_peak["d"],
            "trough_date": dd_trough["d"],
        },
        "splits": splits,
        "dividends_by_year": dividends_by_year,
    }


# ── insight generation (rule-based narrative) ──────────────────────────────

def generate_insights(profile: dict, series: dict[str, Series], phases: list[dict],
                      ratios: list[dict], f_score: dict | None, z: dict | None,
                      story: dict | None) -> dict[str, list[str]]:
    """Turn the computed analysis into written, human-readable findings.
    Every sentence is produced by an explicit rule over the data."""
    ins: dict[str, list[str]] = {
        "timeline": [], "revenue": [], "profitability": [], "balance_sheet": [],
        "cash_flow": [], "shareholder_returns": [], "health": [], "summary": [],
    }
    name = profile.get("name") or "The company"
    rev = series.get("revenue", [])
    ni = series.get("net_income", [])
    rev_m, ni_m = _as_map(rev), _as_map(ni)

    # Timeline
    if profile.get("first_filing_date"):
        ins["timeline"].append(
            f"{name} has been an SEC registrant since at least {profile['first_filing_date'][:4]}, "
            f"with {profile['filings_indexed']}+ filings indexed, including "
            f"{profile['form_counts'].get('10-K', 0)} annual reports (10-K) and "
            f"{profile['form_counts'].get('10-Q', 0)} quarterly reports (10-Q)."
        )
    if profile.get("sic_description"):
        ins["timeline"].append(f"The SEC classifies its business as: {profile['sic_description']}.")
    if rev:
        ins["timeline"].append(
            f"Audited financial statements are available for fiscal years {rev[0]['year']} through "
            f"{rev[-1]['year']} — {len(rev)} years of filed data underpin this analysis."
        )

    # Revenue
    if len(rev) >= 2:
        first, last = rev[0], rev[-1]
        span = last["year"] - first["year"]
        cagr = _cagr(first["value"], last["value"], span)
        growth_mult = last["value"] / first["value"] if first["value"] > 0 else None
        line = (f"Revenue grew from {_fmt_money(first['value'])} in FY{first['year']} to "
                f"{_fmt_money(last['value'])} in FY{last['year']}")
        if cagr is not None:
            line += f" — a {cagr:.1f}% compound annual growth rate over {span} years"
        if growth_mult and growth_mult >= 2:
            line += f", a {growth_mult:.0f}x expansion" if growth_mult >= 3 else ", roughly doubling"
        ins["revenue"].append(line + ".")

        yoy = [(rev[i]["year"], (rev[i]["value"] / rev[i - 1]["value"] - 1) * 100)
               for i in range(1, len(rev)) if rev[i - 1]["value"] > 0]
        if yoy:
            best = max(yoy, key=lambda t: t[1])
            worst = min(yoy, key=lambda t: t[1])
            ins["revenue"].append(
                f"The strongest year was FY{best[0]} (+{best[1]:.1f}%); the weakest was "
                f"FY{worst[0]} ({worst[1]:+.1f}%)."
            )
            declines = [y for y, g in yoy if g < 0]
            if declines:
                ins["revenue"].append(
                    f"Revenue contracted in {len(declines)} of the last {len(yoy)} years "
                    f"({', '.join(f'FY{d}' for d in declines[-4:])})."
                )
            else:
                ins["revenue"].append(f"Revenue has never declined year-over-year in the filed record — {len(yoy)} consecutive years of growth or stability.")
    for ph in phases:
        ins["revenue"].append(
            f"{ph['label']} phase from FY{ph['start_year']} to FY{ph['end_year']} "
            f"(avg {ph['avg_growth_pct']:+.1f}%/yr)."
        )

    # Profitability
    if ni:
        loss_years = [p["year"] for p in ni if p["value"] < 0]
        profit_years = [p["year"] for p in ni if p["value"] > 0]
        if profit_years and loss_years:
            first_profit = min(y for y in profit_years if y > max(loss_years, default=0)) \
                if max(loss_years) < max(profit_years) else None
            if first_profit:
                ins["profitability"].append(
                    f"{name} crossed into sustained profitability in FY{first_profit} after "
                    f"{len([y for y in loss_years if y < first_profit])} loss-making years."
                )
            else:
                ins["profitability"].append(
                    f"Profitability has been inconsistent: {len(loss_years)} loss years out of "
                    f"{len(ni)} on record, most recently FY{max(loss_years)}."
                )
        elif profit_years:
            ins["profitability"].append(
                f"{name} has been profitable in every one of the {len(ni)} filed years."
            )
        elif loss_years:
            ins["profitability"].append(
                f"{name} has not yet reported an annual profit — {len(loss_years)} consecutive loss years."
            )
        record = max(ni, key=lambda p: p["value"])
        ins["profitability"].append(
            f"Record annual profit: {_fmt_money(record['value'])} in FY{record['year']}."
        )
    margins = [(r["year"], r["net_margin"]) for r in ratios if r.get("net_margin") is not None]
    if len(margins) >= 6:
        early = [m for _, m in margins[:3]]
        late = [m for _, m in margins[-3:]]
        e_avg, l_avg = sum(early) / 3, sum(late) / 3
        direction = "expanded" if l_avg > e_avg + 1 else ("compressed" if l_avg < e_avg - 1 else "held steady")
        ins["profitability"].append(
            f"Net margin has {direction} across the company's life: averaging {e_avg:.1f}% in the first "
            f"three filed years vs {l_avg:.1f}% in the most recent three."
        )

    # Balance sheet
    eq = series.get("equity", [])
    if len(eq) >= 2:
        cagr = _cagr(eq[0]["value"], eq[-1]["value"], eq[-1]["year"] - eq[0]["year"])
        line = (f"Shareholders' equity moved from {_fmt_money(eq[0]['value'])} (FY{eq[0]['year']}) to "
                f"{_fmt_money(eq[-1]['value'])} (FY{eq[-1]['year']})")
        if cagr is not None:
            line += f", compounding at {cagr:.1f}%/yr"
        ins["balance_sheet"].append(line + ".")
    lev = [(r["year"], r["debt_to_equity"]) for r in ratios if r.get("debt_to_equity") is not None]
    if len(lev) >= 4:
        early_l, late_l = lev[0][1], lev[-1][1]
        if late_l > early_l * 1.5:
            ins["balance_sheet"].append(
                f"Leverage has risen materially: liabilities-to-equity moved from {early_l:.2f} "
                f"(FY{lev[0][0]}) to {late_l:.2f} (FY{lev[-1][0]})."
            )
        elif late_l < early_l * 0.67:
            ins["balance_sheet"].append(
                f"The balance sheet has deleveraged over time: liabilities-to-equity fell from "
                f"{early_l:.2f} (FY{lev[0][0]}) to {late_l:.2f} (FY{lev[-1][0]})."
            )
        else:
            ins["balance_sheet"].append(
                f"Leverage has stayed broadly stable across the filed record "
                f"(liabilities-to-equity {early_l:.2f} → {late_l:.2f})."
            )

    # Cash flow
    ocf = series.get("ocf", [])
    capex = _as_map(series.get("capex", []))
    ocf_m = _as_map(ocf)
    if ocf:
        pos = [p for p in ocf if p["value"] > 0]
        ins["cash_flow"].append(
            f"Operating cash flow was positive in {len(pos)} of {len(ocf)} filed years"
            + (f", most recently {_fmt_money(pos[-1]['value'])} in FY{pos[-1]['year']}." if pos else ".")
        )
        fcf_years = [(p["year"], p["value"] - abs(capex.get(p["year"], 0))) for p in ocf if p["year"] in capex]
        if fcf_years:
            latest_fcf = fcf_years[-1]
            ins["cash_flow"].append(
                f"Free cash flow (operating cash flow minus capital expenditure) was "
                f"{_fmt_money(latest_fcf[1])} in FY{latest_fcf[0]}."
            )
    # Require OCF > 0 to exclude years where both OCF and NI are negative
    # (negative ÷ negative = positive ratio, falsely implying earnings quality).
    conv = [(r["year"], r["ocf_to_ni"]) for r in ratios
            if r.get("ocf_to_ni") is not None and r["ocf_to_ni"] > 0
            and ocf_m.get(r["year"], 0) > 0]
    if len(conv) >= 3:
        avg_conv = sum(c for _, c in conv) / len(conv)
        if avg_conv >= 1.1:
            ins["cash_flow"].append(
                f"Earnings quality is strong: operating cash flow has averaged {avg_conv:.1f}x reported "
                f"net income, meaning profits are consistently backed by real cash."
            )
        elif avg_conv < 0.8:
            ins["cash_flow"].append(
                f"Earnings quality warrants scrutiny: operating cash flow has averaged only "
                f"{avg_conv:.1f}x reported net income — accruals make up a meaningful share of earnings."
            )

    # Shareholder returns
    if story:
        if story.get("total_return_pct") is not None:
            line = (f"Since {story['first_date'][:4]}, the share price moved from "
                    f"${story['first_close']:,.2f} to ${story['last_close']:,.2f} "
                    f"({story['total_return_pct']:+,.0f}% price return")
            if story.get("cagr_pct") is not None:
                line += f", {story['cagr_pct']:+.1f}%/yr"
            ins["shareholder_returns"].append(line + ", excluding dividends).")
        dd = story.get("max_drawdown")
        if dd and dd["pct"] < -20:
            ins["shareholder_returns"].append(
                f"The deepest drawdown was {dd['pct']:.0f}%, from the {dd['peak_date'][:7]} peak to the "
                f"{dd['trough_date'][:7]} trough — context for the volatility long-term holders endured."
            )
        ath = story.get("all_time_high")
        if ath and story.get("last_close"):
            off = (story["last_close"] / ath["price"] - 1) * 100
            if off < -5:
                ins["shareholder_returns"].append(
                    f"Shares currently trade {off:.0f}% below the all-time high of ${ath['price']:,.2f} "
                    f"set in {ath['date'][:7]}."
                )
            else:
                ins["shareholder_returns"].append("Shares are trading at or near their all-time high.")
        if story.get("splits"):
            ins["shareholder_returns"].append(
                f"The stock has split {len(story['splits'])} time(s): "
                + "; ".join(f"{s['ratio']} in {s['date'][:4]}" for s in story["splits"][-5:]) + "."
            )
        divs = story.get("dividends_by_year") or []
        if divs:
            paying_years = [d for d in divs if d["value"] > 0]
            if paying_years:
                first_div = paying_years[0]
                ins["shareholder_returns"].append(
                    f"Dividends have been paid since at least {first_div['year']}, most recently "
                    f"${paying_years[-1]['value']:.2f}/share/year."
                )
                if len(paying_years) >= 5:
                    d_cagr = _cagr(paying_years[0]["value"], paying_years[-1]["value"],
                                   paying_years[-1]["year"] - paying_years[0]["year"])
                    if d_cagr is not None and d_cagr > 0:
                        ins["shareholder_returns"].append(
                            f"The dividend has grown at {d_cagr:.1f}%/yr over that period."
                        )
        else:
            ins["shareholder_returns"].append("The company does not pay a dividend.")

    # Health
    if f_score:
        s = f_score["score"]
        verdict = "strong" if s >= 7 else ("middling" if s >= 4 else "weak")
        ins["health"].append(
            f"Piotroski F-Score: {s}/9 for FY{f_score['fiscal_year']} — a {verdict} fundamental "
            f"trajectory ({sum(1 for c in f_score['checks'] if c['pass'])} of 9 strength tests passed)."
        )
    if z:
        zone_text = {
            "Safe": "well clear of financial-distress territory",
            "Grey": "in the indeterminate 'grey zone' — not distressed, but worth monitoring",
            "Distress": "in the statistical distress zone; balance-sheet risk is elevated",
            "Incomplete": "indeterminate — fewer than 5 components available for a full assessment",
        }.get(z["zone"], "indeterminate")
        ins["health"].append(
            f"Altman Z-Score: {z['score']} (FY{z['fiscal_year']}) — {zone_text}."
        )

    # Summary synthesis: pick the single most defining fact from each area
    if len(rev) >= 2 and rev[0]["value"] > 0:
        mult = rev[-1]["value"] / rev[0]["value"]
        arc = ("a dramatic expansion story" if mult >= 10 else
               "a solid long-term growth story" if mult >= 3 else
               "a mature, slow-compounding business" if mult >= 1.2 else
               "a business whose revenue has stagnated or declined")
        ins["summary"].append(
            f"Across {rev[-1]['year'] - rev[0]['year']} years of audited filings, {name} reads as {arc}: "
            f"revenue {_fmt_money(rev[0]['value'])} → {_fmt_money(rev[-1]['value'])}."
        )
    if phases:
        current = phases[-1]
        ins["summary"].append(
            f"The company is currently in a {current['label'].lower()} phase "
            f"(since FY{current['start_year']}, averaging {current['avg_growth_pct']:+.1f}%/yr)."
        )
    if ni_m and rev_m:
        latest_year = max(set(ni_m) & set(rev_m), default=None)
        if latest_year and rev_m[latest_year]:
            nm = ni_m[latest_year] / rev_m[latest_year] * 100
            ins["summary"].append(
                f"Latest filed year (FY{latest_year}): {_fmt_money(rev_m[latest_year])} revenue, "
                f"{_fmt_money(ni_m[latest_year])} net income ({nm:.1f}% net margin)."
            )
    if f_score and z:
        ins["summary"].append(
            f"Combined health read: F-Score {f_score['score']}/9, Z-Score {z['score']} ({z['zone']} zone)."
        )

    return ins
