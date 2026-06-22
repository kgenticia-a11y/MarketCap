"""Portfolio Health Score — pure calculation, no DB/IO.

Four sub-scores (0-25 each) sum to a 0-100 total, mapped to a letter grade.
Kept separate from market_data.py / portfolio router so the scoring formula
can be unit-tested or tuned without touching fetch/DB plumbing.
"""

# Mirrors the sector-beta fallback used historically on the frontend
# (frontend/src/pages/Portfolio.tsx) for holdings yfinance doesn't supply a
# real beta for (some ETFs/ADRs return None).
_SECTOR_BETA_FALLBACK: dict[str, float] = {
    "Technology": 1.35, "Communication Services": 1.2, "Consumer Cyclical": 1.15,
    "Financial Services": 1.1, "Industrials": 1.0, "Healthcare": 0.85,
    "Basic Materials": 0.9, "Energy": 0.95, "Real Estate": 0.75,
    "Consumer Defensive": 0.6, "Utilities": 0.5, "Other": 1.0,
}


def _diversification_score(holdings: list[dict]) -> tuple[int, int]:
    """0-25 points: sector spread (up to 15) + holding count (up to 10)."""
    sectors = {h.get("sector") or "Other" for h in holdings}
    sector_pts = min(len(sectors) / 6 * 15, 15)
    holding_pts = min(len(holdings) / 15 * 10, 10)
    return round(min(sector_pts + holding_pts, 25)), len(sectors)


def _portfolio_beta(holdings: list[dict], total_value: float) -> float:
    if not total_value:
        return 1.0
    weighted = 0.0
    for h in holdings:
        weight = h.get("value", 0) / total_value
        beta = h.get("beta")
        if not isinstance(beta, (int, float)):
            beta = _SECTOR_BETA_FALLBACK.get(h.get("sector") or "Other", 1.0)
        weighted += weight * beta
    return weighted


def _volatility_score(beta: float) -> tuple[int, str]:
    """0-25 points: Low beta (<0.8) is healthiest, High (>1.15) is riskiest."""
    if beta < 0.8:
        return 25, "Low"
    if beta < 1.15:
        # Linear taper from 25 (beta=0.8) down to 15 (beta=1.15)
        return round(25 - (beta - 0.8) / 0.35 * 10), "Medium"
    # Linear taper from 15 (beta=1.15) down to 0 (beta=2.0+)
    return max(0, round(15 - (beta - 1.15) / 0.85 * 15)), "High"


def _concentration_score(top_pct: float) -> int:
    """0-25 points: top position <50% of portfolio scores full marks."""
    if top_pct <= 50:
        return 25
    return max(0, round(25 - (top_pct - 50) * (25 / 50)))


def _beta_score(beta: float) -> int:
    """0-25 points: beta within [0.8, 1.2] (near the market) scores full marks."""
    delta = max(0.0, beta - 1.2, 0.8 - beta)
    return max(0, round(25 - delta * 50))


def _grade(score: int) -> str:
    if score >= 90: return "A"
    if score >= 75: return "B"
    if score >= 60: return "C"
    if score >= 40: return "D"
    return "F"


def _explanation(
    diversification: int, volatility: int, concentration: int, beta_pts: int,
    sectors: int, top_pct: float, top_ticker: str, beta: float,
) -> str:
    weakest = min(
        [("diversification", diversification), ("concentration", concentration), ("beta", beta_pts)],
        key=lambda x: x[1],
    )[0]
    if weakest == "concentration" and concentration < 25:
        return (
            f"Your portfolio is highly concentrated in {top_ticker} ({top_pct:.0f}% of total value). "
            "Consider trimming this position and spreading into 2-3 other holdings to improve your score."
        )
    if weakest == "diversification" and diversification < 25:
        return (
            f"Your portfolio is concentrated in just {sectors} sector(s). "
            "Consider adding positions in 2-3 other sectors to improve your score."
        )
    if weakest == "beta" and beta_pts < 25:
        if beta > 1.2:
            return (
                f"Your portfolio is more volatile than the market (beta {beta:.2f}). "
                "Consider adding lower-beta holdings, like utilities or consumer staples, to stabilize returns."
            )
        return (
            f"Your portfolio is more conservative than the market (beta {beta:.2f}). "
            "That limits downside, but may also cap upside in strong bull markets."
        )
    return "Your portfolio is well balanced across sectors, positions, and market sensitivity. Keep it up."


def compute_health_score(holdings: list[dict], total_value: float) -> dict:
    """holdings: list of dicts with sector, value, allocation_pct, beta, ticker."""
    if not holdings:
        return {
            "score": 0, "grade": "F",
            "sub_scores": {
                "diversification": {"score": 0, "max": 25, "level": "risk"},
                "volatility":      {"score": 0, "max": 25, "level": "risk", "label": "—"},
                "concentration":   {"score": 0, "max": 25, "level": "risk"},
                "beta":            {"score": 0, "max": 25, "level": "risk", "value": 0},
            },
            "explanation": "Add holdings to your portfolio to see your Health Score.",
        }

    diversification, sectors = _diversification_score(holdings)
    beta = _portfolio_beta(holdings, total_value)
    volatility, vol_label = _volatility_score(beta)
    top = max(holdings, key=lambda h: h.get("allocation_pct", 0))
    top_pct = top.get("allocation_pct", 0)
    concentration = _concentration_score(top_pct)
    beta_pts = _beta_score(beta)

    total = diversification + volatility + concentration + beta_pts

    def _level(pts: int) -> str:
        if pts >= 20: return "healthy"
        if pts >= 12: return "caution"
        return "risk"

    return {
        "score": total,
        "grade": _grade(total),
        "sub_scores": {
            "diversification": {"score": diversification, "max": 25, "level": _level(diversification)},
            "volatility":      {"score": volatility, "max": 25, "level": _level(volatility), "label": vol_label},
            "concentration":   {"score": concentration, "max": 25, "level": _level(concentration)},
            "beta":            {"score": beta_pts, "max": 25, "level": _level(beta_pts), "value": round(beta, 2)},
        },
        "explanation": _explanation(
            diversification, volatility, concentration, beta_pts,
            sectors, top_pct, top.get("ticker", ""), beta,
        ),
    }
