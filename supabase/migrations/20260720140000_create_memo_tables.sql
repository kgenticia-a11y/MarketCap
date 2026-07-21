-- Investment memo + thesis tracking feature (Batch 1).
--
-- Five new tables:
--   investment_memos   — one row per memo a user writes about a ticker
--   moat_scorecards    — 1:1 with memo, five 1-5 moat dimensions
--   comps_analyses     — 1:1 with memo, peer ticker list + notes
--   dcf_scenarios      — N:1 with memo (base / bull / bear / custom)
--   thesis_checkpoints — N:1 with memo, the learning-loop price checks
--
-- RLS matches the pattern already used on portfolios: RLS enabled with
-- deny-all policies for the anon and authenticated roles. The app's users
-- are NOT Supabase Auth users (the FastAPI backend has its own users table
-- and JWT auth, and connects as the table owner, which bypasses RLS), so
-- auth.uid() policies would never match. Per-user isolation is enforced in
-- the API layer with WHERE user_id = <authenticated user id> on every query.

CREATE TABLE IF NOT EXISTS public.investment_memos (
    id                     SERIAL PRIMARY KEY,
    user_id                INTEGER NOT NULL REFERENCES public.users(id),
    ticker                 TEXT NOT NULL,
    status                 TEXT NOT NULL DEFAULT 'draft'
                           CHECK (status IN ('draft', 'published', 'archived')),
    created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    published_at           TIMESTAMPTZ,
    business_overview      TEXT,
    moat_notes             TEXT,
    financial_health_notes TEXT,
    valuation_notes        TEXT,
    risks                  TEXT,
    thesis_summary         TEXT,
    recommendation         TEXT
                           CHECK (recommendation IN ('buy', 'hold', 'pass', 'watch')),
    price_at_memo          DOUBLE PRECISION,
    price_target           DOUBLE PRECISION,
    target_horizon_months  INTEGER
);
CREATE INDEX IF NOT EXISTS ix_investment_memos_user_id
    ON public.investment_memos (user_id);

CREATE TABLE IF NOT EXISTS public.moat_scorecards (
    id               SERIAL PRIMARY KEY,
    memo_id          INTEGER NOT NULL UNIQUE REFERENCES public.investment_memos(id),
    pricing_power    INTEGER CHECK (pricing_power    BETWEEN 1 AND 5),
    switching_costs  INTEGER CHECK (switching_costs  BETWEEN 1 AND 5),
    network_effects  INTEGER CHECK (network_effects  BETWEEN 1 AND 5),
    scale_advantages INTEGER CHECK (scale_advantages BETWEEN 1 AND 5),
    brand_moat       INTEGER CHECK (brand_moat       BETWEEN 1 AND 5),
    notes            TEXT
);

CREATE TABLE IF NOT EXISTS public.comps_analyses (
    id           SERIAL PRIMARY KEY,
    memo_id      INTEGER NOT NULL UNIQUE REFERENCES public.investment_memos(id),
    peer_tickers TEXT[] NOT NULL DEFAULT '{}',
    notes        TEXT
);

-- tax_rate_pct is not in the original spec's column list, but the Batch 3
-- DCF calculator has an editable tax-rate input (default 21%); without the
-- column a saved scenario could not reproduce its own fair value on reload.
CREATE TABLE IF NOT EXISTS public.dcf_scenarios (
    id                   SERIAL PRIMARY KEY,
    memo_id              INTEGER NOT NULL REFERENCES public.investment_memos(id),
    scenario_name        TEXT NOT NULL,
    revenue_growth_pct   DOUBLE PRECISION NOT NULL,
    operating_margin_pct DOUBLE PRECISION NOT NULL,
    tax_rate_pct         DOUBLE PRECISION NOT NULL DEFAULT 21,
    discount_rate_pct    DOUBLE PRECISION NOT NULL,
    terminal_growth_pct  DOUBLE PRECISION NOT NULL,
    projection_years     INTEGER NOT NULL DEFAULT 5,
    fair_value_per_share DOUBLE PRECISION,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_dcf_scenarios_memo_name UNIQUE (memo_id, scenario_name)
);
CREATE INDEX IF NOT EXISTS ix_dcf_scenarios_memo_id
    ON public.dcf_scenarios (memo_id);

CREATE TABLE IF NOT EXISTS public.thesis_checkpoints (
    id                    SERIAL PRIMARY KEY,
    memo_id               INTEGER NOT NULL REFERENCES public.investment_memos(id),
    checked_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    price_at_check        DOUBLE PRECISION NOT NULL,
    pct_change_since_memo DOUBLE PRECISION NOT NULL,
    days_since_memo       INTEGER NOT NULL,
    notes                 TEXT
);
CREATE INDEX IF NOT EXISTS ix_thesis_checkpoints_memo_id
    ON public.thesis_checkpoints (memo_id);

-- RLS: deny-all for the Supabase client roles, same as every other table.
ALTER TABLE public.investment_memos   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.moat_scorecards    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.comps_analyses     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dcf_scenarios      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.thesis_checkpoints ENABLE ROW LEVEL SECURITY;

CREATE POLICY memos_no_anon        ON public.investment_memos   FOR ALL TO anon          USING (false);
CREATE POLICY memos_no_auth        ON public.investment_memos   FOR ALL TO authenticated USING (false);
CREATE POLICY moat_no_anon         ON public.moat_scorecards    FOR ALL TO anon          USING (false);
CREATE POLICY moat_no_auth         ON public.moat_scorecards    FOR ALL TO authenticated USING (false);
CREATE POLICY comps_no_anon        ON public.comps_analyses     FOR ALL TO anon          USING (false);
CREATE POLICY comps_no_auth        ON public.comps_analyses     FOR ALL TO authenticated USING (false);
CREATE POLICY dcf_no_anon          ON public.dcf_scenarios      FOR ALL TO anon          USING (false);
CREATE POLICY dcf_no_auth          ON public.dcf_scenarios      FOR ALL TO authenticated USING (false);
CREATE POLICY checkpoints_no_anon  ON public.thesis_checkpoints FOR ALL TO anon          USING (false);
CREATE POLICY checkpoints_no_auth  ON public.thesis_checkpoints FOR ALL TO authenticated USING (false);
