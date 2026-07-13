"""Backtest engine for the paper-trading "Strategies" UI.

Pure historical replay over yfinance daily-close history. Returns the
ending balance, total return, CAGR, a sparse time series for the chart,
and a SPY benchmark on the same window so the user can see whether the
chosen strategy beat the index. No live positions are opened — this is a
read-only "what if" tool.

Two strategies for now:

* ``buy_hold`` — single purchase on day one, hold to the end.
* ``dca``     — dollar-cost-average. ``amount`` is the *total* budget
                spread evenly across the period at ``frequency`` cadence,
                so a $10K DCA can be compared apples-to-apples against a
                $10K lump-sum buy & hold.
"""
from __future__ import annotations

import logging
from datetime import date, datetime, timedelta
from typing import Literal

import pandas as pd
import yfinance as yf

from app.services.market_data import _run

logger = logging.getLogger(__name__)


# Caps so a single backtest can't pull arbitrarily long history. yfinance
# silently truncates very-long requests for some tickers; "10y" is a
# round number that still covers two cycles and stays inside Yahoo's
# stable window.
_PERIOD_TO_DAYS: dict[str, int] = {
    "1y": 365, "3y": 365 * 3, "5y": 365 * 5, "10y": 365 * 10,
}
_FREQUENCY_TO_DAYS: dict[str, int] = {
    "weekly": 7, "monthly": 30, "quarterly": 91,
}
_BENCHMARK = "SPY"
# Chart point cap. yfinance returns ~252 trading days per year, so 10y
# would be ~2520 rows — too many for a sparkline. Sample uniformly down.
_MAX_CHART_POINTS = 180

Strategy = Literal["buy_hold", "dca"]
Period = Literal["1y", "3y", "5y", "10y"]
Frequency = Literal["weekly", "monthly", "quarterly"]


def _resample_for_chart(series: pd.Series) -> list[dict]:
    """Down-sample a value series so the frontend receives at most
    _MAX_CHART_POINTS rows — keeps the JSON payload small and the chart
    legible without dropping the start/end points."""
    if len(series) <= _MAX_CHART_POINTS:
        sampled = series
    else:
        # Ceiling division so the resulting count is guaranteed ≤ cap.
        # plain // can leave the stride at 1 when len is only slightly
        # over the cap (e.g. 252/180 → 1), which silently disables the
        # downsample.
        step = (len(series) + _MAX_CHART_POINTS - 1) // _MAX_CHART_POINTS
        sampled = series.iloc[::step]
        # Always include the last point so the ending value is exact.
        if sampled.index[-1] != series.index[-1]:
            sampled = pd.concat([sampled, series.iloc[[-1]]])
    return [
        {"date": ts.strftime("%Y-%m-%d"), "value": round(float(v), 2)}
        for ts, v in sampled.items()
    ]


def _buy_hold_series(close: pd.Series, amount: float) -> pd.Series:
    """Single purchase on day one. Shares are fractional so the entire
    ``amount`` is deployed regardless of share price."""
    shares = amount / float(close.iloc[0])
    return close * shares


def _dca_series(close: pd.Series, amount: float, frequency: Frequency) -> tuple[pd.Series, list[tuple[pd.Timestamp, float]]]:
    """Evenly-spaced contributions over the period. ``amount`` is the
    total budget, so a 5y monthly DCA of $10K invests ≈$167 per month —
    making the strategy directly comparable to a $10K buy & hold."""
    step_days = _FREQUENCY_TO_DAYS[frequency]
    contribution_dates: list[pd.Timestamp] = []
    cursor = close.index[0]
    end = close.index[-1]
    while cursor <= end:
        contribution_dates.append(cursor)
        cursor = cursor + pd.Timedelta(days=step_days)

    n = len(contribution_dates)
    per_contribution = amount / n

    # Walk forward through the close series, accumulating shares whenever
    # a contribution date is reached or passed. searchsorted-style lookup
    # so each trading day still receives a valuation row.
    shares_held = 0.0
    cash_invested = 0.0
    contrib_idx = 0
    values: list[float] = []
    for ts, price in close.items():
        while contrib_idx < n and contribution_dates[contrib_idx] <= ts:
            shares_held += per_contribution / float(price)
            cash_invested += per_contribution
            contrib_idx += 1
        values.append(shares_held * float(price))
    cashflows = [(d, per_contribution) for d in contribution_dates]
    return pd.Series(values, index=close.index), cashflows


def _fetch_close(ticker: str, days: int) -> pd.Series:
    """Pull daily closes for ``ticker`` covering at least ``days`` calendar
    days. Drops NaN rows (Yahoo's silent-fail pattern) and returns just
    the Close series."""
    end = datetime.utcnow().date()
    # Buffer of 30 calendar days so weekends/holidays don't trim the
    # window past what the user asked for.
    start = end - timedelta(days=days + 30)
    hist = yf.Ticker(ticker).history(
        start=start.strftime("%Y-%m-%d"),
        end=end.strftime("%Y-%m-%d"),
        interval="1d",
        auto_adjust=True,
    )
    if hist.empty or "Close" not in hist:
        raise ValueError(f"No price history available for '{ticker}'.")
    close = hist["Close"].dropna()
    if close.empty:
        raise ValueError(f"No usable closes for '{ticker}' in the requested window.")
    # Trim to exactly the requested window relative to the latest close.
    cutoff = close.index[-1] - pd.Timedelta(days=days)
    close = close[close.index >= cutoff]
    if len(close) < 2:
        raise ValueError(f"Not enough history for '{ticker}' over the requested period.")
    return close


def _run_strategy(close: pd.Series, strategy: Strategy, amount: float, frequency: Frequency):
    """Returns (value_series, cashflows). cashflows is None for lump-sum
    strategies and the contribution schedule for DCA — _summary needs it to
    compute an honest annualized figure."""
    if strategy == "buy_hold":
        return _buy_hold_series(close, amount), None
    if strategy == "dca":
        return _dca_series(close, amount, frequency)
    raise ValueError(f"Unknown strategy '{strategy}'.")


def _money_weighted_cagr_pct(end_value: float, cashflows: list, end_ts) -> float:
    """Annualized money-weighted (IRR) return for a contribution schedule,
    solved by bisection on sum(c·(1+r)^yᵢ) = end_value. The old lump-sum
    formula treated every DCA dollar as if invested from day one, which
    systematically misstated the strategy's annualized return."""
    years = [max(0.0, (end_ts - ts).days / 365.25) for ts, _ in cashflows]
    if max(years, default=0.0) < 1 / 365.25:
        return 0.0

    def fv(rate: float) -> float:
        return sum(c * (1.0 + rate) ** y for (_, c), y in zip(cashflows, years))

    lo, hi = -0.9999, 10.0
    if end_value <= fv(lo):
        return lo * 100
    if end_value >= fv(hi):
        return hi * 100
    for _ in range(80):
        mid = (lo + hi) / 2
        if fv(mid) < end_value:
            lo = mid
        else:
            hi = mid
    return (lo + hi) / 2 * 100


def _summary(values: pd.Series, amount: float, cashflows: list | None = None) -> dict:
    """Headline stats for the result card. CAGR uses calendar-day delta
    so a 5y window comes out as ≈5 even if Yahoo trimmed a few days.
    For DCA (cashflows given) the annualized figure is money-weighted."""
    start_value = amount
    end_value = float(values.iloc[-1])
    days = max(1, (values.index[-1] - values.index[0]).days)
    years = days / 365.25
    total_return_pct = (end_value / start_value - 1) * 100
    if cashflows:
        cagr_pct = _money_weighted_cagr_pct(end_value, cashflows, values.index[-1])
    else:
        cagr_pct = ((end_value / start_value) ** (1 / years) - 1) * 100 if years > 0 else 0.0
    return {
        "start_value": round(start_value, 2),
        "end_value": round(end_value, 2),
        "total_return_pct": round(total_return_pct, 2),
        "cagr_pct": round(cagr_pct, 2),
        "years": round(years, 2),
    }


def _backtest_sync(
    ticker: str,
    strategy: Strategy,
    period: Period,
    amount: float,
    frequency: Frequency,
) -> dict:
    """Synchronous core. Lives off the event loop because yfinance is
    blocking; the async wrapper below hands it to the shared executor."""
    days = _PERIOD_TO_DAYS[period]

    ticker_close = _fetch_close(ticker.upper(), days)
    ticker_values, ticker_cashflows = _run_strategy(ticker_close, strategy, amount, frequency)

    # SPY benchmark uses buy-and-hold regardless of the user's strategy
    # choice — the question the chart answers is "did your strategy beat
    # the index?", which only makes sense if SPY itself is a fixed
    # baseline rather than re-running the same strategy on SPY.
    try:
        benchmark_close = _fetch_close(_BENCHMARK, days)
        benchmark_values = _buy_hold_series(benchmark_close, amount)
        benchmark_summary = _summary(benchmark_values, amount)
        benchmark_chart = _resample_for_chart(benchmark_values)
    except Exception as exc:  # benchmark failure must not kill the result
        logger.warning("Backtest benchmark fetch failed for %s: %s", _BENCHMARK, exc)
        benchmark_summary = None
        benchmark_chart = []

    return {
        "ticker": ticker.upper(),
        "strategy": strategy,
        "period": period,
        "frequency": frequency if strategy == "dca" else None,
        "summary": _summary(ticker_values, amount, ticker_cashflows),
        "chart": _resample_for_chart(ticker_values),
        "benchmark": {
            "ticker": _BENCHMARK,
            "summary": benchmark_summary,
            "chart": benchmark_chart,
        } if benchmark_summary else None,
    }


async def run_backtest(
    ticker: str,
    strategy: Strategy,
    period: Period,
    amount: float,
    frequency: Frequency = "monthly",
) -> dict:
    return await _run(
        _backtest_sync, ticker, strategy, period, amount, frequency,
    )
