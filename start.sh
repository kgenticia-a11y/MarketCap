#!/usr/bin/env bash
# Start both the MarketCap backend and frontend for local development.
# Run from the marketcap/ directory:  ./start.sh

set -e
ROOT="$(cd "$(dirname "$0")" && pwd)"

cleanup() {
  echo ""
  echo "Stopping servers…"
  kill "$BACKEND_PID" "$FRONTEND_PID" 2>/dev/null || true
  wait "$BACKEND_PID" "$FRONTEND_PID" 2>/dev/null || true
  echo "Done."
}
trap cleanup EXIT INT TERM

echo "Starting MarketCap backend on http://localhost:8000 …"
cd "$ROOT/backend"
source venv/bin/activate
uvicorn app.main:app --port 8000 --log-level warning &
BACKEND_PID=$!

echo "Starting MarketCap frontend on http://localhost:5173 …"
cd "$ROOT/frontend"
npm run dev --silent &
FRONTEND_PID=$!

echo ""
echo "  Backend:  http://localhost:8000"
echo "  Frontend: http://localhost:5173"
echo "  Press Ctrl+C to stop both."
echo ""

wait
