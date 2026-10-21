-- FND-10: pg_cron calls the app's job tick every minute (TAD section 8).
--
-- The tick URL and its secret differ per environment and are secrets, so they live in Supabase
-- Vault (names jobs_tick_url and jobs_tick_secret), set once per environment as described in
-- docs/runbooks/jobs.md, never in a migration (rule 13). Until both are set the tick does nothing,
-- so local and CI databases stay quiet.

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;--> statement-breakpoint

-- Not in an API exposed schema, so the Supabase Data API cannot call it.
CREATE SCHEMA IF NOT EXISTS internal;--> statement-breakpoint
REVOKE ALL ON SCHEMA internal FROM PUBLIC;--> statement-breakpoint

-- Sends one tick to the app. Returns the pg_net request id, or null when the URL or secret is
-- not configured.
CREATE OR REPLACE FUNCTION internal.jobs_tick() RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  tick_url text;
  tick_secret text;
BEGIN
  SELECT decrypted_secret INTO tick_url FROM vault.decrypted_secrets WHERE name = 'jobs_tick_url';
  SELECT decrypted_secret INTO tick_secret FROM vault.decrypted_secrets WHERE name = 'jobs_tick_secret';
  IF tick_url IS NULL OR tick_secret IS NULL THEN
    RETURN NULL;
  END IF;
  RETURN net.http_post(
    url := tick_url,
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || tick_secret,
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 55000
  );
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.jobs_tick() FROM PUBLIC;--> statement-breakpoint

-- Every minute. cron.schedule replaces a job with the same name, so this is safe to re-run.
SELECT cron.schedule('jobs-tick', '* * * * *', 'SELECT internal.jobs_tick()');
