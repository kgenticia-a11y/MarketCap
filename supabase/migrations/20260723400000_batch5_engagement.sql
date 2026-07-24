-- Batch 5: Engagement layer
--
-- New table: notifications
--   In-app notification centre. Rows are inserted by the backend when
--   earnings recaps and news impacts are generated, and by the weekly
--   digest edge function. Unread count drives the bell badge in the UI.
--
-- RLS: deny-all for anon + authenticated Supabase roles. FastAPI owns access.

CREATE TABLE IF NOT EXISTS public.notifications (
    id         SERIAL PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    type       TEXT NOT NULL,        -- 'earnings_recap' | 'news_impact' | 'digest'
    message    TEXT NOT NULL,
    link       TEXT,                 -- optional deep link, e.g. /ticker/AAPL
    read_at    TIMESTAMPTZ,          -- NULL = unread
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_notifications_user_id
    ON public.notifications (user_id);
CREATE INDEX IF NOT EXISTS ix_notifications_user_unread
    ON public.notifications (user_id, read_at)
    WHERE read_at IS NULL;

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY notifications_no_anon
    ON public.notifications FOR ALL TO anon          USING (false);
CREATE POLICY notifications_no_auth
    ON public.notifications FOR ALL TO authenticated USING (false);
