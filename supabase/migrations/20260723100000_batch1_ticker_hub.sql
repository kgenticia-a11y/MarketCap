-- Batch 1: Ticker Intelligence Hub + Watchlist Research Notes
--
-- Changes:
--   1. watchlists — add notes / notes_updated_at for lightweight research scratchpad
--   2. ticker_news_summaries — per-URL AI summary cache (shared across all users)
--
-- RLS pattern: deny-all for anon + authenticated Supabase roles. The FastAPI
-- backend connects as the table owner and bypasses RLS; per-user isolation is
-- enforced in the API layer with WHERE user_id = <authenticated user id>.

-- ── 1. Watchlist research notes ───────────────────────────────────────────
ALTER TABLE public.watchlists
    ADD COLUMN IF NOT EXISTS notes TEXT,
    ADD COLUMN IF NOT EXISTS notes_updated_at TIMESTAMPTZ;

-- ── 2. News summary cache ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ticker_news_summaries (
    id           SERIAL PRIMARY KEY,
    ticker       TEXT NOT NULL,
    url          TEXT NOT NULL,
    headline     TEXT NOT NULL,
    source       TEXT,
    published_at TIMESTAMPTZ,
    ai_summary   TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_ticker_news_url UNIQUE (url)
);
CREATE INDEX IF NOT EXISTS ix_ticker_news_summaries_ticker
    ON public.ticker_news_summaries (ticker);

ALTER TABLE public.ticker_news_summaries ENABLE ROW LEVEL SECURITY;
CREATE POLICY news_summaries_no_anon
    ON public.ticker_news_summaries FOR ALL TO anon          USING (false);
CREATE POLICY news_summaries_no_auth
    ON public.ticker_news_summaries FOR ALL TO authenticated USING (false);
