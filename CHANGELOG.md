# Changelog

## 2026-07-21 — Investment memos + thesis tracking

New guided workflow for evaluating a stock the way a corp-dev team evaluates
an acquisition — and then holding your past self accountable when the market
proves the thesis right or wrong.

### Added

- **Investment Memos**. Five new Supabase tables (`investment_memos`,
  `moat_scorecards`, `comps_analyses`, `dcf_scenarios`,
  `thesis_checkpoints`) plus 15 new API endpoints (`/memos/*`, `/dcf/*`,
  `/memos/{id}/checkpoints`, `/memos/performance`,
  `/internal/auto-checkpoint`). Per-user isolation is enforced in the API
  layer with `WHERE user_id = current_user.id` on every query, matching the
  existing RLS-deny-all pattern.
- **Memo builder UI** at `/memos`, `/memos/new`, `/memos/:id/edit`,
  `/memos/:id`. Seven guided sections (ticker, business overview, moat
  scorecard, financial health, valuation, risks, thesis) with
  dirty-field-tracked autosave (2 s debounce, flush on blur/beforeunload),
  a live financial snapshot sidebar, and a publish flow that snapshots
  today's price as the permanent tracking reference point.
- **Comps table** in the Valuation section: peer ticker chips, live P/E,
  EV/EBITDA, revenue growth, gross margin from Yahoo, peer-median row, and
  a subject-vs-peers delta on the highlighted row.
- **Guided DCF calculator** in the Valuation section: base / bull / bear
  scenario tabs with sensible defaults (base seeded from live
  fundamentals), sliders for growth / margin / tax / WACC / terminal
  growth, projected FCF table, and fair-value-per-share output with upside
  vs current price. Idempotent save-per-scenario-name via POST-then-PATCH.
- **Thesis reflections** on the read-only view: manual reflection button
  snapshots current price and lets you annotate what changed, plus a price
  sparkline and chronological checkpoint list.
- **Weekly auto-checkpoint** cron via Supabase pg_cron + pg_net (Sundays
  07:00 UTC) hitting the secret-gated backend endpoint. Two vault secrets
  must be set out-of-band before the schedule fires:
  `marketcap_backend_url` and `marketcap_checkpoint_key` (matches the
  backend's `CHECKPOINT_CRON_SECRET`).
- **Thesis performance dashboard** at `/memos/performance`: aggregate
  stats, per-memo sparklines, sorted worst-first so painful memos surface
  where the learning is.
- **30-day reflection nudge** on Home: highlights memos that haven't been
  reflected on in 30+ days; hidden entirely when nothing is stale.
- **`/stocks/fundamentals/{ticker}`** service endpoint — 30 min TTL,
  single-flight coalesced, powers both the financial snapshot sidebar and
  the DCF base-case defaults.

### Migrations

- `20260720140000_create_memo_tables.sql` — memo/moat/comps/dcf/checkpoint
  tables with RLS deny-all policies (applied).
- `20260721100000_weekly_memo_checkpoint_cron.sql` — installs the pg_cron
  schedule (idempotent: unschedules any prior job of the same name).
  **Not applied automatically** — run `supabase db push` or apply via the
  Supabase dashboard after setting the two vault secrets above.

## 2026-07-20 — Feature-pruning pass

Refocusing the product on the upcoming guided investment-memo / thesis-tracking
workflow. Trimming surface area that wasn't earning its keep.

### Removed

- **Price alerts.** Backend router, 90-second in-process alert-evaluation
  loop, `PriceAlert` model, alert context in the AI daily brief, alert rows
  in the auth data export, and the `triggered_at` boot migration are all
  gone. Frontend: Alerts page (Home tab), `AlertModal`, alerts API client,
  the Set Alert flow on the stock page, the Price Alerts section in
  Settings, and alert actions in watchlist and portfolio rows.
  Data (2 rows) archived in `archive/2026-07-price_alerts.csv`;
  `price_alerts` table dropped in migration
  `20260720120000_drop_price_alerts.sql`.

- **Multi-account aggregation.** Backend accounts router, `UserAccount`
  model, `PortfolioItem.account_id` / `account_name`, all account filters
  and the multi-account 409 disambiguation in the portfolio router, and the
  account-column boot migration removed. Frontend: accounts API client,
  Portfolio account selector and Account column, account dropdown in the
  add-position form, and Connected Accounts section in Settings.
  Data (1 row in `user_accounts`; 3 rows in `portfolio_items`) archived in
  `archive/2026-07-user_accounts.csv` and
  `archive/2026-07-portfolio_items_accounts.csv`; table and columns dropped
  in migration `20260720120100_drop_user_accounts.sql`.

### Changed

- **Non-critical price polling downgraded to 15 minutes.** Portfolio
  holdings (batched quotes), watchlist rows, and the screener's background
  re-stream now refresh every 15 min instead of 60s / 60s / 5 min. Stock
  detail page keeps its 30s refresh — it reads a shared backend cache and
  is effectively free. Data source is yfinance (no paid feed anywhere), so
  the dollar cost delta is $0; the win is reduced Yahoo rate-limit
  pressure and client bandwidth.

- **Paper trading parked behind a feature flag.** New
  `VITE_ENABLE_PAPER_TRADING` env var: default on in local dev, off in
  production builds, overridable either way. When enabled, the nav entry
  lives in a new "Labs" sidebar section; when disabled, the route and nav
  entry are absent entirely. The `paper_portfolio`,
  `paper_portfolio_items`, `paper_trade_history` tables and the
  `/paper-trading` API endpoints are untouched — the feature returns
  later, gated to tickers the user has written a memo for.

### Fixed

- `INFRASTRUCTURE.md` incorrectly spelled the domain as
  `marketcap.kystems.live`; the correct domain is
  `marketcap.ksystems.live`. Backend CORS config already used the correct
  spelling.
