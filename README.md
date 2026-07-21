# MarketCap

A real-time stock tracking web app — portfolios, watchlists, live charts, and a stock screener. Backend in FastAPI, frontend in React + Vite.

Uses Yahoo Finance via `yfinance` for free market data — no paid API keys required.

## Quick start

```bash
# Backend
cd backend
python3 -m venv venv && source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env          # fill in JWT_SECRET, ADMIN_TOKEN
uvicorn app.main:app --reload --port 8000

# Frontend (in another terminal)
cd frontend
npm install
cp .env.example .env          # leave VITE_API_URL=http://localhost:8000 for local
npm run dev
```

Open <http://localhost:5173>.

## Stack

| Layer       | Tech                                                         |
|-------------|--------------------------------------------------------------|
| Frontend    | React 19, TypeScript, Vite, Tailwind, React Query, Recharts  |
| Backend     | FastAPI, SQLAlchemy 2, Pydantic v2, SQLite (Postgres-ready)  |
| Auth        | JWT (python-jose) + bcrypt                                   |
| Market data | `yfinance` — no API key needed                               |
| Live prices | React Query polling: 30 s on stock detail; 15 min for non-critical views (portfolio, watchlist, screener) |
| Toasts      | Sonner                                                       |

## Features

- Portfolio with live P&L and historical value chart
- Watchlist with mini-sparklines
- Stock screener with sector / market-cap / P/E filters
- Income estimator (dividend projection)
- Interactive candlestick chart
- Institutional-format analyst report (AI-narrative or docs-driven)
- **Investment memos**: guided workflow for evaluating a stock
  (business / moat / financials / valuation / risks / thesis), with a
  comps table, base/bull/bear DCF calculator, and thesis-tracking
  reflections that snapshot price at publish and check in weekly.
- AI co-pilot: daily brief, chart analysis, pre-earnings briefs, chat assistant
- Dark + light mode, customisable accent colour
- ⌘K search with arrow-key navigation and recent searches

Paper trading is present in the codebase but parked behind
`VITE_ENABLE_PAPER_TRADING` pending a memo-gated relaunch (off by default
in production).

## Configuration

All backend settings live in `backend/.env`. See `backend/.env.example` for the full list. Notable variables:

| Variable                  | Purpose                                                    |
|---------------------------|------------------------------------------------------------|
| `DATABASE_URL`            | SQLAlchemy URL (sqlite or postgresql)                      |
| `JWT_SECRET`              | Long random string used to sign JWTs                       |
| `ALLOWED_ORIGINS`         | Comma-separated list of frontend origins (CORS)            |
| `ADMIN_TOKEN`             | Required header for `/admin/*` — empty disables admin      |
| `AUTO_FIXER_ENABLED`      | Run the local code auto-fixer every N hours (dev only)     |
| `AUTO_FIXER_INTERVAL_HOURS` | Interval for the auto-fixer loop                         |
| `CHECKPOINT_CRON_SECRET`  | Shared secret for the weekly memo auto-checkpoint endpoint. Must match the `marketcap_checkpoint_key` vault secret in Supabase. Empty disables the endpoint. |

Frontend config is in `frontend/.env` — only `VITE_API_URL`.

## Deploying

```bash
# Build both images and bring up the stack
docker-compose up --build
```

For production, set real values in `backend/.env` (especially `JWT_SECRET`, `ADMIN_TOKEN`, and `ALLOWED_ORIGINS`) and build the frontend with the right `VITE_API_URL`:

```bash
docker build --build-arg VITE_API_URL=https://api.your-domain.com -t marketcap-frontend ./frontend
```

## Endpoints

- `GET /health` — readiness + DB liveness check (returns 503 if DB down)
- `GET /docs` — OpenAPI / Swagger UI
- `POST /admin/auto-fix` — runs the bug-fixer on demand (requires `X-Admin-Token`)
- `GET /admin/auto-fix/log` — auto-fixer run log

## Auto-fixer

`backend/app/services/auto_fixer.py` runs `py_compile`, `tsc --noEmit`, `eslint --fix`, optional `ruff --fix`, and a curated pattern library every 5 hours when enabled. Disabled by default in production via `AUTO_FIXER_ENABLED=false`.

## Disclaimer

For informational and educational use only. Not financial advice.
