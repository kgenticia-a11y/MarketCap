-- Drop the multi-account aggregation feature.
--
-- Feature-pruning pass 2026-07-20: user_accounts and the account_id /
-- account_name columns on portfolio_items are removed; the portfolio
-- collapses back to a single-portfolio-per-user view. Existing rows were
-- exported to archive/2026-07-user_accounts.csv and
-- archive/2026-07-portfolio_items_accounts.csv before this migration ran.
--
-- The backend code that referenced these columns (routers/accounts.py,
-- UserAccount model, account filters in routers/portfolio.py, the
-- account-column lightweight-migration) was deleted in a prior commit and
-- deployed to Fly.io before this migration is applied, so no live queries
-- reference the columns by the time they disappear.
--
-- The lightweight-migration only added the columns, never a foreign-key
-- constraint or a modified unique index, so UNIQUE (portfolio_id, ticker)
-- is still in place and doesn't need to be recreated.

ALTER TABLE public.portfolio_items DROP COLUMN IF EXISTS account_id;
ALTER TABLE public.portfolio_items DROP COLUMN IF EXISTS account_name;

DROP TABLE IF EXISTS public.user_accounts;
