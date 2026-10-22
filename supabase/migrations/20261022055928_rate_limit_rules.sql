-- IAM-11: rate limits on sign in, patient links and webhooks (TAD section 8). Counters live in
-- public.rate_limit, written only by the server's own connection: RLS is on with no policy, so no
-- staff member or patient reads or writes them. No audit trigger: every attempt would bury the
-- real events (like public.job).

-- Windows older than a day are never read again. Returns how many rows went.
CREATE OR REPLACE FUNCTION internal.prune_rate_limits() RETURNS integer
LANGUAGE sql
SET search_path = ''
AS $$
  WITH gone AS (
    DELETE FROM public.rate_limit WHERE window_start < now() - interval '1 day' RETURNING 1
  )
  SELECT count(*)::integer FROM gone
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.prune_rate_limits() FROM PUBLIC;--> statement-breakpoint

-- Every hour. cron.schedule replaces a job with the same name, so this is safe to re-run.
SELECT cron.schedule('rate-limit-prune', '17 * * * *', 'SELECT internal.prune_rate_limits()');--> statement-breakpoint

-- The limits (rule 6; user decision 22 October 2026: the balanced set).
SELECT set_config('audit.actor', 'system:migration', false);--> statement-breakpoint
INSERT INTO public.setting (key, value, updated_by) VALUES
  ('limits.sign_in_per_email', '{"count": 5, "minutes": 15}', 'system:migration'),
  ('limits.sign_in_per_network', '{"count": 30, "minutes": 15}', 'system:migration'),
  ('limits.reset_email_per_email', '{"count": 3, "minutes": 60}', 'system:migration'),
  ('limits.reset_email_per_network', '{"count": 20, "minutes": 60}', 'system:migration'),
  ('limits.two_step_per_person', '{"count": 5, "minutes": 15}', 'system:migration'),
  ('limits.bad_links_per_network', '{"count": 20, "minutes": 10}', 'system:migration'),
  ('limits.link_opens_per_network', '{"count": 120, "minutes": 1}', 'system:migration'),
  ('limits.webhook_failures_per_network', '{"count": 10, "minutes": 1}', 'system:migration')
ON CONFLICT (key) DO NOTHING;--> statement-breakpoint
SELECT set_config('audit.actor', '', false);
