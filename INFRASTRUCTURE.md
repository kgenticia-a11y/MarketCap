# Infrastructure & Scaling Notes

This document captures the known limitations of the current architecture so you
can plan around them when scaling horizontally.

---

# 🚨 RUNBOOK — "The site is down"

## Platform dependency chain

A request flows through five independently-owned platforms. Any one breaking
takes down some or all of the site:

```
User
 │  DNS: marketcap.kystems.live  ── managed by LOVABLE (registrar: Name.com)
 ▼
Vercel  ── serves the React frontend (per-deploy URLs + custom domain)
 │  HTTPS calls to VITE_API_URL
 ▼
Fly.io  ── runs the FastAPI backend (app: marketcap-backend)
 │  DATABASE_URL (Supabase pooler, port 5432)
 ▼
Supabase Postgres  ── all user data (RLS enabled)
 │
 └─ yfinance / Yahoo Finance  ── market data (no key; flaky upstream)
```

## First triage — find the broken layer (60 seconds)

Run these top-down; the first one that fails is your layer:

```bash
# 1. DNS resolves?  (Lovable → Vercel)
dig +short marketcap.kystems.live          # blank/NXDOMAIN = DNS not configured

# 2. Frontend up?   (Vercel)
curl -I https://marketcap.kystems.live     # expect 200/3xx

# 3. Backend alive?  (Fly process)
curl -s https://marketcap-backend.fly.dev/health/live   # {"status":"alive"} = process OK

# 4. Backend ready?  (Fly + Supabase DB)
curl -s https://marketcap-backend.fly.dev/health        # "database":"ok" = DB reachable
```

| Symptom | Broken layer | Go to |
|---|---|---|
| `dig` is blank / NXDOMAIN | DNS (Lovable) | §A |
| DNS resolves, site won't load | Vercel | §B |
| `/health/live` fails or times out | Fly process down | §C |
| `/health/live` OK but `/health` 503 | Supabase DB / credentials | §D |
| Site loads, prices missing | yfinance upstream | §E |

---

### §A — DNS not resolving (Lovable / Name.com)

`marketcap.kystems.live` is registered through **Lovable**; DNS is edited in the
Lovable dashboard, not Name.com directly. Needed record:

| Type | Host | Value |
|---|---|---|
| CNAME | `marketcap` | `cname.vercel-dns.com` |

After adding, propagation is 1–30 min. Verify: `dig @8.8.8.8 +short marketcap.kystems.live`.
Cross-check Vercel's expectation: `npx vercel domains inspect kystems.live`.

### §B — Frontend down (Vercel)

```bash
npx vercel ls                       # is the latest Production deploy ● Ready?
npx vercel inspect <deploy-url>     # build logs
```
Rollback: redeploy a known-good commit, or `npx vercel rollback`.
Note: a bad `VITE_API_URL` env at build time points the app at the wrong backend —
check Vercel project env vars.

### §C — Backend process down (Fly)  ← the outage we hardened against

```bash
fly status  --app marketcap-backend
fly logs    --app marketcap-backend
```
The app now **boots in degraded mode even if the DB is unreachable** (see
"Resilient startup" below), so a DB problem should NOT kill the process anymore.
If `/health/live` is still failing, it's a real process/deploy fault:
- Look for a Python traceback in `fly logs` (bad import, syntax error, OOM).
- `fly apps restart marketcap-backend` to force a fresh machine.
- Roll back: `fly releases --app marketcap-backend` then `fly deploy --image <prev>`.

### §D — DB unreachable / auth failed (Supabase)  ← what took us down once

Symptom in logs: `password authentication failed` or `connection refused`.
**Most common cause: a rotated Supabase password not propagated to Fly.**

NEVER set `DATABASE_URL` blind. Use the guarded setter, which tests the
connection first and only pushes to Fly if it works:

```bash
cd backend
./scripts/set-database-url.sh 'postgresql+psycopg2://postgres.<ref>:<NEWPASS>@aws-1-us-east-2.pooler.supabase.com:5432/postgres'
```

Also update `backend/.env` to match (local dev + preflight use it). Other causes:
Supabase project paused (free tier) → resume in dashboard; pooler maxed →
check Supabase → Database → Connection pooling.

### §E — Market data missing (yfinance)

Yahoo rate-limits / delists symbols intermittently. The backend already caches
(30s–10min TTLs) and degrades gracefully (returns 502 on a single endpoint, not
a crash). Usually self-resolves. If persistent, lower `YF_POOL_SIZE`.

---

## Deploy safely (every time)

```bash
cd backend
./scripts/preflight.py        # validates env + live DB SELECT 1 before anything
./scripts/deploy.sh           # preflight, then fly deploy
```

Preflight is the gate that turns "deploy a broken credential → crash loop" into
"deploy blocked locally, nothing changes in prod."

## Resilient startup (why a DB blip no longer = outage)

`app/main.py` was changed so the backend **never crashes at boot when the DB is
down**:
- Schema init retries with backoff; on persistent failure the app still starts
  (degraded) and a background loop self-heals the moment the DB returns.
- `/health/live` (liveness, no DB) drives Fly's restart decision → a DB outage
  can't crash-loop the machine to death (the previous failure: "max restart
  count of 10 → machine dead").
- `/health` (readiness, pings DB) only controls traffic routing + monitoring.

Before: rotated password → boot crash → 10 Fly restarts → permanent outage,
manual redeploy required.
After: rotated password → degraded mode, 503 on data endpoints, **auto-recovers**
when `DATABASE_URL` is fixed; the process never dies.

---

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
