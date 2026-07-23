-- Batch 3: News + Thesis Impact
--
-- New table: memo_news_impacts
--   Stores AI-generated impact assessments of news headlines against a user's
--   published investment memo thesis. One row per (memo, url) pair; generated
--   on demand when the user reviews their news feed.
--
-- RLS: deny-all for anon + authenticated Supabase roles. FastAPI owns access.

CREATE TABLE IF NOT EXISTS public.memo_news_impacts (
    id           SERIAL PRIMARY KEY,
    memo_id      INTEGER NOT NULL REFERENCES public.investment_memos(id) ON DELETE CASCADE,
    url          TEXT NOT NULL,
    ticker       TEXT NOT NULL,
    headline     TEXT NOT NULL,
    impact       TEXT NOT NULL,        -- 'strengthens' | 'weakens' | 'neutral'
    impact_reason TEXT,
    published_at TIMESTAMPTZ,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_memo_news_impact UNIQUE (memo_id, url)
);

CREATE INDEX IF NOT EXISTS ix_memo_news_impacts_memo_id
    ON public.memo_news_impacts (memo_id);
CREATE INDEX IF NOT EXISTS ix_memo_news_impacts_ticker
    ON public.memo_news_impacts (ticker);

ALTER TABLE public.memo_news_impacts ENABLE ROW LEVEL SECURITY;
CREATE POLICY news_impacts_no_anon
    ON public.memo_news_impacts FOR ALL TO anon          USING (false);
CREATE POLICY news_impacts_no_auth
    ON public.memo_news_impacts FOR ALL TO authenticated USING (false);
