#!/usr/bin/env bash
#
# set-database-url.sh — Safely rotate the Supabase database password everywhere.
#
# You only need to paste the PASSWORD (from Supabase dashboard).
# This script builds the full DATABASE_URL, tests the connection, updates Fly,
# AND updates your local backend/.env — all atomically.
#
# Usage:
#   cd backend
#   ./scripts/set-database-url.sh
#
# You will be prompted for the password with hidden input — it never echoes to
# your shell or appears in history.
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$(dirname "$SCRIPT_DIR")"
ENV_FILE="$BACKEND_DIR/.env"
APP="${FLY_APP:-marketcap-backend}"

# Supabase project reference — update this if you ever migrate projects.
SUPABASE_REF="xqzqcibsxhsirraujeac"
SUPABASE_POOLER="aws-1-us-east-2.pooler.supabase.com"

RED='\033[31m'; GREEN='\033[32m'; YELLOW='\033[33m'; RESET='\033[0m'

echo ""
echo -e "${YELLOW}── MarketCap DB password rotation ─────────────────────${RESET}"
echo "This will update: Fly secret + local .env"
echo "Source: Supabase → Settings → Database → Reset database password"
echo ""

# ── 1. Get the new password (hidden input, never stored in shell history) ──
read -rsp "Paste the NEW Supabase database password: " NEW_PASS
echo ""

if [[ -z "${NEW_PASS:-}" ]]; then
  echo -e "${RED}No password entered. Aborting.${RESET}"
  exit 1
fi

# ── 2. Build the full SQLAlchemy URL (transaction pooler — required for Fly) ──
# Note: the pooler username format is postgres.<ref>, NOT just postgres.
# Using URL-encoding for special chars in the password.
ENCODED_PASS="$(python3 -c "import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1], safe=''))" "$NEW_PASS")"
CANDIDATE_URL="postgresql+psycopg2://postgres.${SUPABASE_REF}:${ENCODED_PASS}@${SUPABASE_POOLER}:5432/postgres"

# ── 3. Pick python (prefer project venv) ──────────────────────────────────
PY="python3"
if [[ -x "$BACKEND_DIR/venv/bin/python3" ]]; then
  PY="$BACKEND_DIR/venv/bin/python3"
fi

# ── 4. Test the connection BEFORE touching anything ───────────────────────
echo -e "${YELLOW}Testing database connection…${RESET}"
if ! DATABASE_URL="$CANDIDATE_URL" "$PY" "$SCRIPT_DIR/preflight.py" --db-only; then
  echo ""
  echo -e "${RED}Connection FAILED — nothing was changed.${RESET}"
  echo ""
  echo "Common causes:"
  echo "  • Password not yet saved in Supabase — wait a few seconds and retry"
  echo "  • Supabase project paused (free tier) — resume it in the dashboard first"
  echo "  • Wrong password copied — go back to Supabase and copy it again"
  echo "  • Network issue — check your internet connection"
  echo ""
  echo -e "Supabase dashboard: ${YELLOW}https://supabase.com/dashboard/project/${SUPABASE_REF}/settings/database${RESET}"
  exit 1
fi

# ── 5. Update Fly secret ──────────────────────────────────────────────────
echo ""
echo -e "${YELLOW}Updating DATABASE_URL on Fly app '${APP}'…${RESET}"
fly secrets set "DATABASE_URL=$CANDIDATE_URL" --app "$APP"

# ── 6. Update local .env ──────────────────────────────────────────────────
echo -e "${YELLOW}Updating local .env…${RESET}"
if [[ -f "$ENV_FILE" ]]; then
  # Replace existing DATABASE_URL line in-place
  if grep -q "^DATABASE_URL=" "$ENV_FILE"; then
    # Use python for portable in-place replacement (sed -i differs on macOS/Linux)
    "$PY" - "$ENV_FILE" "$CANDIDATE_URL" <<'PYEOF'
import sys
path, new_url = sys.argv[1], sys.argv[2]
lines = open(path).readlines()
out = []
for line in lines:
    if line.startswith("DATABASE_URL="):
        out.append(f"DATABASE_URL={new_url}\n")
    else:
        out.append(line)
open(path, "w").writelines(out)
PYEOF
    echo -e "${GREEN}✓ Updated DATABASE_URL in $ENV_FILE${RESET}"
  else
    echo "DATABASE_URL=$CANDIDATE_URL" >> "$ENV_FILE"
    echo -e "${GREEN}✓ Added DATABASE_URL to $ENV_FILE${RESET}"
  fi
else
  echo "DATABASE_URL=$CANDIDATE_URL" > "$ENV_FILE"
  echo -e "${GREEN}✓ Created $ENV_FILE with DATABASE_URL${RESET}"
fi

# ── 7. Wait for Fly to come back healthy ─────────────────────────────────
echo ""
echo -e "${YELLOW}Waiting for Fly app to become healthy…${RESET}"
HEALTH_URL="https://${APP}.fly.dev/health"
for i in $(seq 1 30); do
  code="$(curl -s -o /dev/null -w '%{http_code}' "$HEALTH_URL" 2>/dev/null || echo 000)"
  if [[ "$code" == "200" ]]; then
    echo -e "${GREEN}✓ App is healthy (HTTP 200). Rotation complete.${RESET}"
    echo ""
    echo "  Fly secret:  updated ✓"
    echo "  Local .env:  updated ✓"
    echo "  DB health:   ok ✓"
    echo ""
    exit 0
  fi
  echo "  Attempt $i/30 — status $code, retrying in 4s…"
  sleep 4
done

echo -e "${RED}App did not come back healthy within 2 min.${RESET}"
echo "Check: fly logs --app $APP"
exit 1
