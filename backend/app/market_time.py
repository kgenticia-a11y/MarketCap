"""
market_time.py — the one place that decides "which trading day is it?".

Containers run in UTC, so date.today() ticks over at 8pm ET — a user
opening the app in the US evening wrote portfolio snapshots under
TOMORROW's date, and the hourly scheduler then skipped the real day's
close because "a row already exists". Every snapshot writer keys off the
US-Eastern calendar date instead.
"""
from datetime import date, datetime
from zoneinfo import ZoneInfo

_EASTERN = ZoneInfo("America/New_York")


def market_date() -> date:
    """Today's date on the US-market (Eastern) calendar."""
    return datetime.now(_EASTERN).date()
