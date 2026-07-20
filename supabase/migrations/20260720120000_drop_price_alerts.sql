-- Drop the price_alerts table.
--
-- Feature-pruning pass 2026-07-20: price alerts are being removed from the
-- product. The 2 existing rows were exported to
-- archive/2026-07-price_alerts.csv before this migration ran.
--
-- The backend code that referenced this table (routers/alerts.py,
-- services/alert_evaluator.py, PriceAlert model, triggered_at
-- lightweight-migration) was deleted in a prior commit and deployed to
-- Fly.io before this DROP is applied, so no live queries reference the
-- table by the time it disappears.

DROP TABLE IF EXISTS public.price_alerts;
