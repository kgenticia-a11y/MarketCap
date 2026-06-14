#!/usr/bin/env python3
"""
preflight.py — Pre-deploy / pre-secret-change validation gate.

Run this BEFORE deploying or before changing a production secret (especially
DATABASE_URL). It catches the class of failure that took the server down once:
a bad/rotated DB credential that the app only discovers at boot — by which
point Fly has already swapped the secret and the machine is crash-looping.

Checks, in order:
  1. All REQUIRED env vars are present.
  2. JWT_SECRET is strong (>=32 chars, not a placeholder).
  3. JWT_ALGORITHM is on the allowlist.
  4. DATABASE_URL parses AND a real connection + `SELECT 1` succeeds.

Usage:
    # Validate the secrets currently in your shell / .env:
    python3 scripts/preflight.py

    # Validate a CANDIDATE database url before pushing it to Fly:
    DATABASE_URL="postgresql+psycopg2://user:newpass@host:5432/db" \
        python3 scripts/preflight.py --db-only

Exit code 0 = safe to deploy. Non-zero = do NOT deploy.
"""
from __future__ import annotations

import argparse
import os
import sys

# Make `app` importable when run from the backend/ dir.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

GREEN = "\033[32m"
RED = "\033[31m"
YELLOW = "\033[33m"
RESET = "\033[0m"

REQUIRED = ["DATABASE_URL", "JWT_SECRET"]
_JWT_ALGS = {"HS256", "HS384", "HS512"}
_PLACEHOLDERS = {
    "change-me-to-a-random-secret", "secret", "changeme",
    "your-secret-key-here", "marketcap-super-secret-change-me-in-production",
}


def _ok(msg: str) -> None:
    print(f"  {GREEN}✓{RESET} {msg}")


def _fail(msg: str) -> None:
    print(f"  {RED}✗ {msg}{RESET}")


def check_required_env() -> list[str]:
    errors = []
    for key in REQUIRED:
        if not os.getenv(key):
            errors.append(f"Missing required env var: {key}")
            _fail(f"{key} is not set")
        else:
            _ok(f"{key} is set")
    return errors


def check_jwt() -> list[str]:
    errors = []
    secret = os.getenv("JWT_SECRET", "")
    if len(secret) < 32:
        errors.append("JWT_SECRET must be at least 32 characters")
        _fail("JWT_SECRET too short (<32 chars)")
    elif secret in _PLACEHOLDERS or "change-me" in secret.lower():
        errors.append("JWT_SECRET is a placeholder value")
        _fail("JWT_SECRET looks like a placeholder")
    else:
        _ok("JWT_SECRET is strong")

    alg = os.getenv("JWT_ALGORITHM", "HS256")
    if alg not in _JWT_ALGS:
        errors.append(f"JWT_ALGORITHM '{alg}' not in {sorted(_JWT_ALGS)}")
        _fail(f"JWT_ALGORITHM '{alg}' is not allowed")
    else:
        _ok(f"JWT_ALGORITHM '{alg}' is valid")
    return errors


def check_db() -> list[str]:
    """The important one: actually connect and run SELECT 1."""
    url = os.getenv("DATABASE_URL", "")
    if not url:
        _fail("DATABASE_URL is not set")
        return ["DATABASE_URL is not set"]

    try:
        from sqlalchemy import create_engine, text
    except Exception as exc:  # pragma: no cover
        _fail(f"SQLAlchemy import failed: {exc}")
        return [f"SQLAlchemy import failed: {exc}"]

    connect_args = {"connect_timeout": 8} if url.startswith("postgresql") else {}
    try:
        engine = create_engine(url, connect_args=connect_args, pool_pre_ping=True)
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        engine.dispose()
        _ok("DATABASE_URL connects and SELECT 1 succeeds")
        return []
    except Exception as exc:
        # Trim the noisy SQLAlchemy URL so a leaked password isn't printed.
        msg = str(exc).split("\n")[0]
        _fail(f"Database connection FAILED: {msg}")
        return [f"Database connection failed: {msg}"]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--db-only", action="store_true",
        help="Only validate DATABASE_URL connectivity (for testing a candidate URL).",
    )
    args = parser.parse_args()

    print(f"\n{YELLOW}── MarketCap deploy preflight ─────────────────────────{RESET}")

    errors: list[str] = []
    if args.db_only:
        errors += check_db()
    else:
        errors += check_required_env()
        errors += check_jwt()
        errors += check_db()

    print()
    if errors:
        print(f"{RED}PREFLIGHT FAILED ({len(errors)} issue(s)). DO NOT DEPLOY.{RESET}")
        for e in errors:
            print(f"  - {e}")
        print()
        return 1

    print(f"{GREEN}PREFLIGHT PASSED — safe to deploy.{RESET}\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
