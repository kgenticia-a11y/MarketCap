-- Batch 2: Earnings Calendar + AI Recap
--
-- New tables:
--   ai_earnings_recaps — post-earnings analysis linked to a published memo.
--     Generated once per (memo, earnings_date) pair by the daily edge function.
--   ai_earnings_briefs — generic per-ticker pre-earnings brief (not user-specific).
--
-- RLS: deny-all for anon + authenticated Supabase roles. The FastAPI
-- backend connects as the table owner and bypasses RLS.

CREATE TABLE IF NOT EXISTS public.ai_earnings_recaps (
    id              SERIAL PRIMARY KEY,
    ticker          TEXT NOT NULL,
    memo_id         INTEGER REFERENCES public.investment_memos(id) ON DELETE SET NULL,
    earnings_date   TEXT NOT NULL,   -- YYYY-MM-DD
    recap_json      TEXT NOT NULL,   -- JSON-encoded recap object
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_earnings_recap_memo_date UNIQUE (memo_id, earnings_date)
);

CREATE INDEX IF NOT EXISTS ix_ai_earnings_recaps_ticker
    ON public.ai_earnings_recaps (ticker);
CREATE INDEX IF NOT EXISTS ix_ai_earnings_recaps_memo_id
    ON public.ai_earnings_recaps (memo_id);

ALTER TABLE public.ai_earnings_recaps ENABLE ROW LEVEL SECURITY;
CREATE POLICY earnings_recaps_no_anon
    ON public.ai_earnings_recaps FOR ALL TO anon          USING (false);
CREATE POLICY earnings_recaps_no_auth
    ON public.ai_earnings_recaps FOR ALL TO authenticated USING (false);

-- ai_earnings_briefs: generic pre-earnings brief cache (not user-specific)
CREATE TABLE IF NOT EXISTS public.ai_earnings_briefs (
    id            SERIAL PRIMARY KEY,
    ticker        TEXT NOT NULL,
    earnings_date TEXT NOT NULL,   -- YYYY-MM-DD
    brief_json    TEXT NOT NULL,   -- JSON-encoded Claude response
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_ai_earnings_briefs_ticker_date UNIQUE (ticker, earnings_date)
);

CREATE INDEX IF NOT EXISTS ix_ai_earnings_briefs_ticker
    ON public.ai_earnings_briefs (ticker);

ALTER TABLE public.ai_earnings_briefs ENABLE ROW LEVEL SECURITY;
CREATE POLICY earnings_briefs_no_anon
    ON public.ai_earnings_briefs FOR ALL TO anon          USING (false);
CREATE POLICY earnings_briefs_no_auth
    ON public.ai_earnings_briefs FOR ALL TO authenticated USING (false);
