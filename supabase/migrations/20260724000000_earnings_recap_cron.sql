-- Daily cron trigger for the earnings-recap edge function (Batch 2).
--
-- Supabase's pg_cron + pg_net fire a POST to the deployed edge function once a
-- day (06:00 UTC, after US after-hours earnings are processed). The edge
-- function then finds published memos whose ticker reported yesterday and calls
-- the backend /internal/earnings-batch endpoint to generate AI recaps.
--
-- Without this schedule the earnings-recap-trigger edge function is deployed but
-- never invoked, so recaps would only ever be generated on demand from the UI.
--
-- Two vault secrets must be set out-of-band before the schedule is armed:
--   marketcap_functions_url     e.g. https://xqzqcibsxhsirraujeac.supabase.co/functions/v1
--   marketcap_service_role_key  the project's service_role key (Bearer auth)
--
-- The edge function is deployed with:
--   supabase functions deploy earnings-recap-trigger --no-verify-jwt
-- and reads FASTAPI_URL + INTERNAL_API_KEY from its own function secrets.
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
    SELECT c.jobid INTO jobid FROM cron.job c WHERE c.jobname = 'marketcap-daily-earnings-recap';
    IF jobid IS NOT NULL THEN
        PERFORM cron.unschedule(jobid);
    END IF;
END $$;

-- Daily at 06:00 UTC. The edge function's AI batch can take a while (one
-- backend call per memo ticker), so allow a generous response window.
SELECT cron.schedule(
    'marketcap-daily-earnings-recap',
    '0 6 * * *',
    $cron$
    SELECT net.http_post(
        url     := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'marketcap_functions_url') || '/earnings-recap-trigger',
        headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'marketcap_service_role_key')
        ),
        body    := '{}'::jsonb,
        timeout_milliseconds := 300000
    );
    $cron$
);
