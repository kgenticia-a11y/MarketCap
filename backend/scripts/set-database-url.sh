#!/usr/bin/env bash
#
# set-database-url.sh — Safely rotate DATABASE_URL on Fly.
#
# This is the guardrail for the exact incident that took the server down:
# a rotated Supabase password was pushed to Fly WITHOUT being tested, the app
# couldn't connect at boot, and Fly crash-looped the machine to death.
#
# This script tests the candidate URL with a real `SELECT 1` FIRST, and only
# calls `fly secrets set` if the connection succeeds. A bad URL can never reach
# the running machine.
#
# Usage:
#   ./scripts/set-database-url.sh 'postgresql+psycopg2://user:NEWPASS@host:5432/db'
#
# Or omit the arg to be prompted (the URL won't echo to your shell history):
#   ./scripts/set-database-url.sh
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$(dirname "$SCRIPT_DIR")"
APP="${FLY_APP:-marketcap-backend}"

RED='\033[31m'; GREEN='\033[32m'; YELLOW='\033[33m'; RESET='\033[0m'

# ── 1. Get the candidate URL (arg or hidden prompt) ────────────────────────
if [[ $# -ge 1 ]]; then
  CANDIDATE_URL="$1"
else
  read -rsp "Paste the new DATABASE_URL (input hidden): " CANDIDATE_URL
  echo ""
fi

if [[ -z "${CANDIDATE_URL:-}" ]]; then
  echo -e "${RED}No DATABASE_URL provided. Aborting.${RESET}"
  exit 1
fi

# ── 2. Pick a python with sqlalchemy (prefer the project venv) ─────────────
PY="python3"
if [[ -x "$BACKEND_DIR/venv/bin/python3" ]]; then
  PY="$BACKEND_DIR/venv/bin/python3"
fi

# ── 3. Test the candidate connection BEFORE touching Fly ───────────────────
echo -e "${YELLOW}Testing the candidate database connection…${RESET}"
if ! DATABASE_URL="$CANDIDATE_URL" "$PY" "$SCRIPT_DIR/preflight.py" --db-only; then
  echo -e "${RED}The candidate DATABASE_URL did NOT connect. Nothing was changed on Fly.${RESET}"
  exit 1
fi

# ── 4. Connection works — push it to Fly ───────────────────────────────────
echo -e "${YELLOW}Connection verified. Setting the secret on Fly app '${APP}'…${RESET}"
fly secrets set "DATABASE_URL=$CANDIDATE_URL" --app "$APP"

# ── 5. Wait for the app to report healthy again ────────────────────────────
echo -e "${YELLOW}Waiting for the app to come back healthy…${RESET}"
URL="https://${APP}.fly.dev/health"
for i in $(seq 1 30); do
  code="$(curl -s -o /dev/null -w '%{http_code}' "$URL" || echo 000)"
  if [[ "$code" == "200" ]]; then
    echo -e "${GREEN}✓ App is healthy (HTTP 200 from /health). Done.${RESET}"
    exit 0
  fi
  sleep 4
done

echo -e "${RED}App did not report healthy within ~2 min. Check: fly logs --app ${APP}${RESET}"
exit 1
