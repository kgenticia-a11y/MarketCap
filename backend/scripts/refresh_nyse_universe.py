#!/usr/bin/env python3
"""
refresh_nyse_universe.py — regenerate app/services/nyse_universe.py.

The NYSE expansion list is a snapshot: small-cap tickers delist, rename,
and get acquired constantly, and dead symbols silently drop out of
breadth/screener coverage. Re-run this script occasionally (quarterly is
plenty) to prune dead tickers and re-rank against the live NYSE directory,
then review and commit the diff like any code change.

Selection rules (same ones documented in nyse_universe.py's docstring):
  * every symbol in the NYSE listing directory (NASDAQ screener feed),
  * common stocks only — preferreds, warrants, rights, SPAC units,
    exchange-traded debt, closed-end funds and ETFs are excluded;
    NYSE-listed ADS commons and MLP common units are kept,
  * minus anything already in the core universe in market_data.py,
  * the 1,500 largest by market cap, topped up from FILL when the ranked
    pool falls short (secondary share classes with a blank cap field).

Only the NYSE_EXPANSION tuple and the docstring date are rewritten — the
assert_unique_universe helper and the rest of the module are untouched.
The rewritten module is imported afterwards, so its own boot invariant
(exactly 1,500 unique tickers) validates the result before you commit.

Usage:
    python3 scripts/refresh_nyse_universe.py            # fetch + rewrite
    python3 scripts/refresh_nyse_universe.py --dry-run  # report only
"""
from __future__ import annotations

import argparse
import ast
import importlib.util
import json
import re
import sys
import urllib.request
from datetime import date
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent
UNIVERSE_PY = BACKEND / "app" / "services" / "nyse_universe.py"
MARKET_DATA_PY = BACKEND / "app" / "services" / "market_data.py"

# Daily-updated mirror of the official NASDAQ screener feed, NYSE exchange.
DEFAULT_SOURCE = (
    "https://raw.githubusercontent.com/rreichel3/US-Stock-Symbols/main/"
    "nyse/nyse_full_tickers.json"
)
SIZE = 1500

# Non-common-stock instruments, matched against the security name:
# preferred stock (incl. "Depositary Shares ... Preferred"), warrants,
# SPAC units ("each consisting of"), rights, notes/debentures/bonds,
# structured/exchange-traded debt wrappers, and closed-end funds that
# avoid the word "Fund" (sponsor family + Trust, term/municipal trusts).
# ADS commons and MLP common units stay in.
BAD_NAME = re.compile(
    r"preferred|warrant|consisting|\bright(s)?\b|\bnotes?\b|debenture"
    r"|\bfund\b|\betf\b|due\s+\d{4}|%"
    r"|zones|strats|saturns|\bpines\b|quibs|corts|\bbond\b"
    r"|term trust|municipal"
    r"|(gabelli|blackrock|royce|invesco|eaton vance|nuveen|john hancock"
    r"|guggenheim|xai|neuberger berman|calamos|pimco|doubleline|virtus"
    r"|cohen & steers|clough|tortoise|duff & phelps|templeton|western asset"
    r"|aberdeen|abrdn|sprott|liberty all[- ]star|adams|tri[- ]?continental"
    r"|general american investors|central securities|source capital"
    r"|first trust)\b.*\btrust\b"
    r"|eagle point|pershing square",
    re.I,
)
# Plain symbols, plus class shares like BF.B / BF/B (Yahoo wants BF-B).
SYM = re.compile(r"^([A-Z]+)([./]([A-Z]))?$")

# Established NYSE operating companies whose secondary share classes have a
# blank market-cap field in the directory; used to top the ranked pool up
# to exactly SIZE (never SPAC shells).
FILL = ["BF-B", "BF-A", "HEI-A", "CRD-A"]


def core_universe() -> set[str]:
    src = MARKET_DATA_PY.read_text()
    m = re.search(r"_UNIVERSE = (\[.*?\n\])", src, re.S)
    if not m:
        sys.exit("could not locate the core _UNIVERSE list in market_data.py")
    return set(ast.literal_eval(m.group(1)))


def select(rows: list[dict], core: set[str]) -> list[str]:
    seen: set[str] = set()
    ranked: list[tuple[str, float]] = []
    for r in rows:
        ms = SYM.match((r.get("symbol") or "").strip())
        if not ms or BAD_NAME.search(r.get("name") or ""):
            continue
        yahoo = ms.group(1) + ("-" + ms.group(3) if ms.group(3) else "")
        if yahoo in core or yahoo in seen:
            continue
        try:
            cap = float(r.get("marketCap") or "")
        except ValueError:
            continue
        if cap <= 0:
            continue
        seen.add(yahoo)
        ranked.append((yahoo, cap))

    ranked.sort(key=lambda x: -x[1])
    picked = [t for t, _ in ranked[:SIZE]]
    for t in FILL:
        if len(picked) >= SIZE:
            break
        if t not in core and t not in picked:
            picked.append(t)
    if len(picked) != SIZE:
        sys.exit(f"only {len(picked)} eligible tickers — expected {SIZE}")
    return picked


def rewrite(tickers: list[str]) -> None:
    lines = []
    for i in range(0, len(tickers), 10):
        lines.append("    " + " ".join(f'"{t}",' for t in tickers[i:i + 10]))
    block = "NYSE_EXPANSION: tuple[str, ...] = (\n" + "\n".join(lines) + "\n)"

    src = UNIVERSE_PY.read_text()
    new_src, n = re.subn(
        r"NYSE_EXPANSION: tuple\[str, \.\.\.\] = \(\n.*?\n\)",
        block, src, count=1, flags=re.S,
    )
    if n != 1:
        sys.exit("could not locate the NYSE_EXPANSION tuple to rewrite")
    new_src = re.sub(
        r"Selection \(\d{4}-\d{2}-\d{2}\)",
        f"Selection ({date.today().isoformat()})", new_src, count=1,
    )
    UNIVERSE_PY.write_text(new_src)


def validate() -> None:
    """Import the rewritten module so its own boot invariant runs."""
    spec = importlib.util.spec_from_file_location("nyse_universe_check", UNIVERSE_PY)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)  # raises on duplicate / wrong count
    overlap = set(module.NYSE_EXPANSION) & core_universe()
    if overlap:
        sys.exit(f"expansion overlaps the core universe: {sorted(overlap)[:10]}")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", default=DEFAULT_SOURCE)
    parser.add_argument("--dry-run", action="store_true",
                        help="report the new selection without rewriting")
    args = parser.parse_args()

    with urllib.request.urlopen(args.source, timeout=30) as resp:
        rows = json.load(resp)
    print(f"NYSE directory rows: {len(rows)}")

    core = core_universe()
    picked = select(rows, core)

    spec = importlib.util.spec_from_file_location("nyse_universe_cur", UNIVERSE_PY)
    current_mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(current_mod)
    current = list(current_mod.NYSE_EXPANSION)
    dropped = sorted(set(current) - set(picked))
    added = sorted(set(picked) - set(current))
    print(f"dropped ({len(dropped)}): {', '.join(dropped[:20])}{'…' if len(dropped) > 20 else ''}")
    print(f"added   ({len(added)}): {', '.join(added[:20])}{'…' if len(added) > 20 else ''}")

    if args.dry_run:
        print("dry run — nyse_universe.py not modified")
        return 0

    rewrite(picked)
    validate()
    print(f"rewrote {UNIVERSE_PY.relative_to(BACKEND)} with {SIZE} tickers — "
          "review the diff and commit.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
