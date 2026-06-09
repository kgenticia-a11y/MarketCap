# MarketCap — Setup Guide

## Prerequisites
- Python 3.12+
- Node.js 20+
- No paid API keys needed — market data comes from Yahoo Finance via `yfinance`

## Backend

```bash
cd backend

# Create venv + install deps
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt

# Copy and fill in env vars (defaults already work for local SQLite dev)
cp .env.example .env
# Edit .env: at minimum set JWT_SECRET to a long random string.
# Generate one with:  python3 -c "import secrets; print(secrets.token_urlsafe(48))"

# Start server
uvicorn app.main:app --reload --port 8000
```

First startup auto-creates all SQLite tables in `backend/marketcap.db`.

API docs at: <http://localhost:8000/docs>
Health check: <http://localhost:8000/health>

## Frontend

```bash
cd frontend
npm install
cp .env.example .env       # leave VITE_API_URL=http://localhost:8000
npm run dev
```

App runs at: <http://localhost:5173> (or `:5174` if `:5173` is busy)

## Environment Variables (backend/.env)

| Key                          | Required | Description                                            |
|------------------------------|----------|--------------------------------------------------------|
| `DATABASE_URL`               | yes      | SQLAlchemy URL (sqlite or postgres)                    |
| `JWT_SECRET`                 | yes      | Long random string used to sign JWTs                   |
| `JWT_ALGORITHM`              | no       | Default `HS256`                                        |
| `JWT_EXPIRE_MINUTES`         | no       | Token lifetime (default 1440 = 24h)                    |
| `ALLOWED_ORIGINS`            | no       | Comma-separated CORS origins (defaults to local Vite)  |
| `ADMIN_TOKEN`                | no       | Header for `/admin/*` — leave empty to disable admin   |
| `AUTO_FIXER_ENABLED`         | no       | Run the local code auto-fixer on a loop (default off)  |
| `AUTO_FIXER_INTERVAL_HOURS`  | no       | Auto-fixer interval, default 5                         |

## Environment Variables (frontend/.env)

| Key             | Description                                       |
|-----------------|---------------------------------------------------|
| `VITE_API_URL`  | Base URL of the backend (default `http://localhost:8000`) |

## Data source

This app pulls market data from Yahoo Finance via the `yfinance` Python library. No API key, no rate limit configuration. The screener and overview endpoints cache aggressively (~5 min) to be polite.

## Switching to Postgres

Just change `DATABASE_URL` to `postgresql+psycopg://user:pass@host/db` and reinstall with the Postgres driver. Indexes on `user_id` / `portfolio_id` / etc. are already declared in the models.
