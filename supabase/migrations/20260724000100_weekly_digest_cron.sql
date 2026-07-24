-- Weekly cron trigger for the digest edge function (Batch 5).
--
-- Supabase's pg_cron + pg_net fire a POST to the deployed edge function once a
-- week (Mondays 09:00 UTC). The edge function builds a per-user digest from
-- Supabase data (portfolio performance, recent news impacts), inserts a
-- 'digest' notification for every user, and sends a summary email via Resend
-- when RESEND_API_KEY is configured on the function.
--
-- Without this schedule the weekly-digest-trigger edge function is deployed but
-- never invoked, so no weekly digest notification or email is ever sent.
--
-- Two vault secrets must be set out-of-band before the schedule is armed:
--   marketcap_functions_url     e.g. https://xqzqcibsxhsirraujeac.supabase.co/functions/v1
--   marketcap_service_role_key  the project's service_role key (Bearer auth)
--
-- The edge function is deployed with:
--   supabase functions deploy weekly-digest-trigger --no-verify-jwt
-- and reads SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY, and
-- DIGEST_FROM_EMAIL from its own function secrets.
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
    SELECT c.jobid INTO jobid FROM cron.job c WHERE c.jobname = 'marketcap-weekly-digest';
    IF jobid IS NOT NULL THEN
        PERFORM cron.unschedule(jobid);
    END IF;
END $$;

-- Mondays 09:00 UTC — start of the trading week, so the digest reflects the
-- prior week's close and the coming week's earnings calendar.
SELECT cron.schedule(
    'marketcap-weekly-digest',
    '0 9 * * 1',
    $cron$
    SELECT net.http_post(
        url     := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'marketcap_functions_url') || '/weekly-digest-trigger',
        headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'marketcap_service_role_key')
        ),
        body    := '{}'::jsonb,
        timeout_milliseconds := 300000
    );
    $cron$
);
