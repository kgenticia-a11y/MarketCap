# Changelog

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
