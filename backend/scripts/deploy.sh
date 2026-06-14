#!/usr/bin/env bash
#
# deploy.sh — Deploy the backend to Fly, but only after preflight passes.
#
# Runs the preflight gate against the secrets ALREADY on Fly (pulled into the
# environment) so a broken DB credential or missing secret blocks the deploy
# instead of producing a crash-looping machine.
#
# Usage:   ./scripts/deploy.sh
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$(dirname "$SCRIPT_DIR")"
APP="${FLY_APP:-marketcap-backend}"

YELLOW='\033[33m'; GREEN='\033[32m'; RED='\033[31m'; RESET='\033[0m'

PY="python3"
if [[ -x "$BACKEND_DIR/venv/bin/python3" ]]; then
  PY="$BACKEND_DIR/venv/bin/python3"
fi

# Verify the secrets that WILL run in production actually work. We can't read
# secret *values* back from Fly, so this validates whatever DATABASE_URL /
# JWT_SECRET are in your current shell (typically sourced from backend/.env,
# which should mirror the Fly secrets).
echo -e "${YELLOW}Running preflight before deploy…${RESET}"
if [[ -f "$BACKEND_DIR/.env" ]]; then
  set -a; # shellcheck disable=SC1091
  source "$BACKEND_DIR/.env"; set +a
fi

if ! "$PY" "$SCRIPT_DIR/preflight.py"; then
  echo -e "${RED}Preflight failed — aborting deploy.${RESET}"
  exit 1
fi

echo -e "${YELLOW}Deploying to Fly app '${APP}'…${RESET}"
cd "$BACKEND_DIR"
fly deploy --app "$APP"

echo -e "${GREEN}Deploy complete. Verify: curl https://${APP}.fly.dev/health${RESET}"
