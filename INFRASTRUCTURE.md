# Infrastructure & Scaling Notes

This document captures the known limitations of the current architecture so you
can plan around them when scaling horizontally.

## Single-process state

The following pieces of state live in **Python module memory** and do not
synchronise across multiple backend instances:

| Component                          | File                            | Impact when scaled                                          |
|------------------------------------|---------------------------------|-------------------------------------------------------------|
| Screener cache (`_screener_data`)  | `app/services/market_data.py`   | Each replica fetches and caches independently. N replicas = N× yfinance calls on cold cache. |
| Market overview response cache     | `app/routers/stocks.py`         | Same as above (60s TTL, per-replica). |
| Auth rate-limit counters           | `app/middleware.py`             | A bad actor gets `max_attempts × N replicas` per minute. |
| Auto-fixer status (`_last_run`)    | `app/routers/admin.py`          | Status endpoint returns a different answer per replica. |

### When you scale to multiple replicas

- **Rate limiter** → move to Redis + a token-bucket library (`slowapi`, `fastapi-limiter`).
- **Screener / overview cache** → Redis with the same TTL keys.
- **Auto-fixer** → run on a single dedicated worker, not the web replicas. Or disable in prod entirely (`AUTO_FIXER_ENABLED=false`, which is the default).

### Live prices

The app uses React Query polling (30–60 s) for live price updates. A previous WebSocket placeholder was removed because it never actually broadcast anything. If sub-second live ticks become a requirement, add a dedicated streaming service (Redis pub/sub + a worker pulling from a real-time data vendor) — don't reintroduce a per-process WebSocket manager.

## Database

- SQLite is fine for single-instance / single-user dev. For any real traffic, switch `DATABASE_URL` to `postgresql+psycopg://…`.
- The engine sets `pool_pre_ping=True` and `pool_recycle=1800` on non-SQLite drivers so idle connections that the DB has dropped are detected at checkout instead of failing the request.
- Default pool: `pool_size=10, max_overflow=20`. Override via `DB_POOL_SIZE` / `DB_MAX_OVERFLOW`.
- Schema is created via `Base.metadata.create_all()` at boot. Alembic is listed in `requirements.txt` but not configured. Adding columns post-deploy requires manual migration. Recommended next step: `alembic init` + auto-generate the first migration from the current models.

## Workers / concurrency

- `WEB_CONCURRENCY` env var controls uvicorn worker count (default 1). For Postgres, raise to ~`2 × CPU + 1`. For SQLite, **keep at 1** — multiple workers contend on the file lock.
- `YF_POOL_SIZE` env var controls the thread pool used for `yfinance` calls (default 6). Yahoo silently rate-limits at higher concurrency; don't push past ~10 per replica.

## Auto-fixer

- **Disabled by default in production.** The fixer mutates `frontend/src/...` and `backend/app/...` files. On read-only container deploys (most platforms), this fails silently. On writable deploys, the changes are lost on the next image build.
- Use it only in dev (`AUTO_FIXER_ENABLED=true`), or run it as a separate one-off job in CI.
- Log file `backend/auto_fix.log` rotates at 1 MB (3 backups kept).

## HTTP timeouts

- Frontend axios client: **30 s** ceiling. Long-running endpoints (screener stream) use raw `fetch()` and bypass this.
- Backend yfinance HTTP calls: 8 s timeout per call.
- Subprocess calls inside the auto-fixer all have explicit timeouts (15 s / 60 s / 120 s / 180 s) so a hung tool never blocks the FastAPI thread pool.

## Observability

- Every request gets an `X-Request-ID` (echoed in the response header). Stash this on `request.state.request_id` and include it in log lines for cross-service tracing.
- `/health` does a `SELECT 1` against the DB and returns 503 if it fails. Wire your orchestrator's liveness probe here.

## Resource limits

- Request body capped at `MAX_BODY_BYTES` (default 1 MB) — anything larger returns 413 before the handler runs.
- No upload endpoints today, so 1 MB is comfortably oversized for legit traffic.

## Backups

- SQLite: just copy `marketcap.db`. Compose mounts it as a host volume.
- Postgres: rely on your managed DB's PITR or run `pg_dump` on a schedule.

## Future hardening (not blocking deploy)

- Alembic migrations (currently `create_all`).
- Real Redis backend for everything in the "Single-process state" table.
- Structured JSON logging.
- Distributed tracing (OpenTelemetry).
- Per-user rate limit (in addition to per-IP) for authenticated endpoints.
- WebSocket auth token validation.
