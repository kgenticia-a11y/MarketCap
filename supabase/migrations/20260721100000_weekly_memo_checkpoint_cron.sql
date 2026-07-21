-- Weekly auto-checkpoint for every published investment memo.
--
-- Supabase's pg_cron + pg_net fire a POST to the backend once a week
-- (Sundays 07:00 UTC). The backend then walks every published memo, fetches
-- one quote per unique ticker (deduped, so 20 memos on AAPL cost one call),
-- and inserts a ThesisCheckpoint row for each one.
--
-- Two vault secrets must be set out-of-band before the schedule is armed:
--   marketcap_backend_url    e.g. https://marketcap-backend.fly.dev
--   marketcap_checkpoint_key must match backend env CHECKPOINT_CRON_SECRET
--
-- This migration is idempotent — the cron.schedule call unschedules any
-- previous job with the same name first, so re-running it just rearms.

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Drop any previous job with this name (idempotent re-runs).
DO $$
DECLARE
    jobid bigint;
BEGIN
    SELECT c.jobid INTO jobid FROM cron.job c WHERE c.jobname = 'marketcap-weekly-memo-checkpoint';
    IF jobid IS NOT NULL THEN
        PERFORM cron.unschedule(jobid);
    END IF;
END $$;

-- Schedule the weekly POST. Sundays 07:00 UTC = quiet slot before the
-- Monday US market open, so the price reflects the actual weekend close
-- (last trading session) instead of racing an in-progress open auction.
SELECT cron.schedule(
    'marketcap-weekly-memo-checkpoint',
    '0 7 * * 0',
    $cron$
    SELECT net.http_post(
        url     := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'marketcap_backend_url') || '/internal/auto-checkpoint',
        headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'X-Checkpoint-Secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'marketcap_checkpoint_key')
        ),
        body    := '{}'::jsonb,
        timeout_milliseconds := 60000
    );
    $cron$
);
