#!/usr/bin/env python3
"""
refresh_nasdaq_universe.py — regenerate app/services/nasdaq_universe.py.

The Nasdaq expansion list is a snapshot: small-cap tickers delist, rename,
and get acquired constantly. Re-run this script occasionally (quarterly is
plenty) to prune dead tickers and re-rank against the live Nasdaq directory,
then review and commit the diff like any code change.

Selection rules:
  * every symbol in the Nasdaq listing directory (NASDAQ Trader symbol feed),
  * common stocks only — preferreds, warrants/rights (trailing W/U suffix),
    SPAC units, exchange-traded debt, closed-end funds and ETFs excluded;
    Nasdaq-listed ADS commons and class-share commons kept,
  * minus anything already in the core universe in market_data.py
    or the NYSE expansion in nyse_universe.py,
  * the 1,000 largest by market cap.

Usage:
    python3 scripts/refresh_nasdaq_universe.py            # fetch + rewrite
    python3 scripts/refresh_nasdaq_universe.py --dry-run  # report only
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
UNIVERSE_PY = BACKEND / "app" / "services" / "nasdaq_universe.py"
MARKET_DATA_PY = BACKEND / "app" / "services" / "market_data.py"
NYSE_UNIVERSE_PY = BACKEND / "app" / "services" / "nyse_universe.py"

DEFAULT_SOURCE = (
    "https://raw.githubusercontent.com/rreichel3/US-Stock-Symbols/main/"
    "nasdaq/nasdaq_full_tickers.json"
)
SIZE = 1000

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
    r"|eagle point|pershing square"
    r"|\btangible equity unit\b"
    r"|\bunit\b.*\bconsisting\b",
    re.I,
)
SYM = re.compile(r"^([A-Z]+)([./]([A-Z]))?$")
UNIT_WARRANT = re.compile(r"^[A-Z]{4,}[WU]$")


def core_universe() -> set[str]:
    src = MARKET_DATA_PY.read_text()
    m = re.search(r"_UNIVERSE = (\[.*?\n\])", src, re.S)
    if not m:
        sys.exit("could not locate the core _UNIVERSE list in market_data.py")
    return set(ast.literal_eval(m.group(1)))


def nyse_universe() -> set[str]:
    src = NYSE_UNIVERSE_PY.read_text()
    m = re.search(r"NYSE_EXPANSION: tuple\[str, \.\.\.\] = \((.*?)\)", src, re.S)
    if not m:
        sys.exit("could not locate NYSE_EXPANSION in nyse_universe.py")
    return set(re.findall(r'"([A-Z][A-Z0-9\-]*)"', m.group(1)))


def select(rows: list[dict], exclude: set[str]) -> list[str]:
    seen: set[str] = set()
    ranked: list[tuple[str, float]] = []
    for r in rows:
        sym_raw = (r.get("symbol") or "").strip()
        if UNIT_WARRANT.match(sym_raw):
            continue
        ms = SYM.match(sym_raw)
        if not ms or BAD_NAME.search(r.get("name") or ""):
            continue
        yahoo = ms.group(1) + ("-" + ms.group(3) if ms.group(3) else "")
        if yahoo in exclude or yahoo in seen:
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
    if len(picked) != SIZE:
        sys.exit(f"only {len(picked)} eligible tickers — expected {SIZE}")
    return picked


def rewrite(tickers: list[str]) -> None:
    lines = []
    for i in range(0, len(tickers), 10):
        lines.append("    " + " ".join(f'"{t}",' for t in tickers[i:i + 10]))
    block = "NASDAQ_EXPANSION: tuple[str, ...] = (\n" + "\n".join(lines) + "\n)"

    src = UNIVERSE_PY.read_text()
    new_src, n = re.subn(
        r"NASDAQ_EXPANSION: tuple\[str, \.\.\.\] = \(\n.*?\n\)",
        block, src, count=1, flags=re.S,
    )
    if n != 1:
        sys.exit("could not locate the NASDAQ_EXPANSION tuple to rewrite")
    new_src = re.sub(
        r"Selection \(\d{4}-\d{2}-\d{2}\)",
        f"Selection ({date.today().isoformat()})", new_src, count=1,
    )
    UNIVERSE_PY.write_text(new_src)


def validate() -> None:
    spec = importlib.util.spec_from_file_location("nasdaq_universe_check", UNIVERSE_PY)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    overlap = set(module.NASDAQ_EXPANSION) & (core_universe() | nyse_universe())
    if overlap:
        sys.exit(f"expansion overlaps existing universe: {sorted(overlap)[:10]}")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", default=DEFAULT_SOURCE)
    parser.add_argument("--dry-run", action="store_true",
                        help="report the new selection without rewriting")
    args = parser.parse_args()

    with urllib.request.urlopen(args.source, timeout=30) as resp:
        rows = json.load(resp)
    print(f"Nasdaq directory rows: {len(rows)}")

    exclude = core_universe() | nyse_universe()
    picked = select(rows, exclude)

    spec = importlib.util.spec_from_file_location("nasdaq_universe_cur", UNIVERSE_PY)
    current_mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(current_mod)
    current = list(current_mod.NASDAQ_EXPANSION)
    dropped = sorted(set(current) - set(picked))
    added = sorted(set(picked) - set(current))
    print(f"dropped ({len(dropped)}): {', '.join(dropped[:20])}{'...' if len(dropped) > 20 else ''}")
    print(f"added   ({len(added)}): {', '.join(added[:20])}{'...' if len(added) > 20 else ''}")

    if args.dry_run:
        print("dry run — nasdaq_universe.py not modified")
        return 0

    rewrite(picked)
    validate()
    print(f"rewrote {UNIVERSE_PY.relative_to(BACKEND)} with {SIZE} tickers — "
          "review the diff and commit.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
