-- FND-09: live screens update within 2 seconds (PRD section 9; TAD section 8, "Realtime"). Changes
-- are signalled, never sent (user decision, 31 October 2026): a change to what the live screens
-- show tells the realtime relay which centres changed, and the relay pings the screens watching
-- them, which then check for changes through their own permission checked routes as they do every
-- few seconds now. Nothing about a patient leaves the database this way.
--
-- The relay's URL and secret differ per environment and are secrets, so they live in Supabase Vault
-- (live_relay_signal_url and live_relay_signal_secret), set once the relay is deployed
-- (docs/runbooks/live-relay.md), never in a migration (rule 13). Until both are set nothing is
-- sent, so local, CI and staging databases stay as they are.

-- Whether the relay is set up: both Vault rows exist (read by name, nothing decrypted), so a
-- database without the relay does no other work for a signal.
CREATE OR REPLACE FUNCTION internal.live_relay_set_up()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT count(DISTINCT name) = 2 FROM vault.secrets
  WHERE name IN ('live_relay_signal_url', 'live_relay_signal_secret');
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.live_relay_set_up() FROM PUBLIC, anon, authenticated;--> statement-breakpoint

-- Tells the relay that these centres (or, for everywhere, every centre) changed. pg_net queues the
-- request in the transaction, so a change rolled back signals nothing, and a relay that is down
-- never holds up the change: pg_net's worker sends it after the commit. Returns the pg_net request
-- id, or null when nothing changed or the relay is not set up.
CREATE OR REPLACE FUNCTION internal.live_signal(centres uuid[], everywhere boolean)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  relay_url text;
  relay_secret text;
BEGIN
  IF NOT everywhere AND coalesce(cardinality(centres), 0) = 0 THEN
    RETURN NULL;
  END IF;
  SELECT
    max(decrypted_secret) FILTER (WHERE name = 'live_relay_signal_url'),
    max(decrypted_secret) FILTER (WHERE name = 'live_relay_signal_secret')
  INTO relay_url, relay_secret
  FROM vault.decrypted_secrets
  WHERE name IN ('live_relay_signal_url', 'live_relay_signal_secret');
  IF relay_url IS NULL OR relay_secret IS NULL THEN
    RETURN NULL;
  END IF;
  RETURN net.http_post(
    url := relay_url,
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || relay_secret,
      'Content-Type', 'application/json'
    ),
    body := jsonb_build_object(
      'centres', CASE WHEN everywhere THEN '[]'::jsonb ELSE to_jsonb(centres) END,
      'all', everywhere
    ),
    timeout_milliseconds := 5000
  );
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.live_signal(uuid[], boolean) FROM PUBLIC, anon, authenticated;--> statement-breakpoint

-- The statement's rows, as the centres they belong to. TG_ARGV[0] says how a row reaches its centre:
--   centre       its own centre_id;
--   episode      its episode's centre;
--   link         its appointment's centre, else its episode's;
--   everywhere   every centre (a physio's leave, which belongs to no centre).
-- Transition tables are named new_rows and old_rows; an update signals the centres before and
-- after, so a row moved between centres changes both. A row deleted with its episode or appointment
-- in the same statement (a cascade) finds no centre and signals nothing; the screens' own check
-- every `live.connected_check_seconds` covers it.
--
-- A signal is a hint, never part of the change: whatever goes wrong here is a warning and the
-- change goes ahead (the screens still check on their own).
CREATE OR REPLACE FUNCTION internal.live_signal_rows()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  how text := TG_ARGV[0];
  centre_of text;
  sources text[];
  source text;
  found_centres uuid[];
  centres uuid[] := '{}';
BEGIN
  IF NOT internal.live_relay_set_up() THEN
    RETURN NULL;
  END IF;
  IF how = 'everywhere' THEN
    PERFORM internal.live_signal('{}', true);
    RETURN NULL;
  END IF;
  centre_of := CASE how
    WHEN 'centre' THEN 'SELECT r.centre_id AS centre FROM %I r'
    WHEN 'episode' THEN
      'SELECT e.centre_id AS centre FROM %I r JOIN public.episode e ON e.id = r.episode_id'
    WHEN 'link' THEN
      'SELECT coalesce(a.centre_id, e.centre_id) AS centre FROM %I r'
      || ' LEFT JOIN public.appointment a ON a.id = r.appointment_id'
      || ' LEFT JOIN public.episode e ON e.id = r.episode_id'
  END;
  IF centre_of IS NULL THEN
    RAISE EXCEPTION 'Unknown live signal mapping %', how;
  END IF;
  sources := CASE TG_OP
    WHEN 'INSERT' THEN ARRAY['new_rows']
    WHEN 'DELETE' THEN ARRAY['old_rows']
    ELSE ARRAY['new_rows', 'old_rows']
  END;
  FOREACH source IN ARRAY sources LOOP
    EXECUTE format(
      'SELECT coalesce(array_agg(DISTINCT centre) FILTER (WHERE centre IS NOT NULL), ''{}'') FROM ('
        || centre_of || ') changed',
      source
    ) INTO found_centres;
    centres := centres || found_centres;
  END LOOP;
  PERFORM internal.live_signal(
    ARRAY(SELECT DISTINCT unnest(centres)),
    false
  );
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  -- The error's code only: its message could carry a value from the row.
  RAISE WARNING 'Live signal skipped (%)', SQLSTATE;
  RETURN NULL;
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.live_signal_rows() FROM PUBLIC, anon, authenticated;--> statement-breakpoint

-- Three triggers per table: Postgres allows transition tables on a trigger for one event only.
CREATE OR REPLACE PROCEDURE internal.add_live_signal_triggers(target regclass, how text)
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  EXECUTE format(
    'CREATE OR REPLACE TRIGGER live_signal_insert AFTER INSERT ON %s'
      || ' REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT'
      || ' EXECUTE FUNCTION internal.live_signal_rows(%L)',
    target, how
  );
  EXECUTE format(
    'CREATE OR REPLACE TRIGGER live_signal_update AFTER UPDATE ON %s'
      || ' REFERENCING NEW TABLE AS new_rows OLD TABLE AS old_rows FOR EACH STATEMENT'
      || ' EXECUTE FUNCTION internal.live_signal_rows(%L)',
    target, how
  );
  EXECUTE format(
    'CREATE OR REPLACE TRIGGER live_signal_delete AFTER DELETE ON %s'
      || ' REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT'
      || ' EXECUTE FUNCTION internal.live_signal_rows(%L)',
    target, how
  );
END;
$$;--> statement-breakpoint
REVOKE ALL ON PROCEDURE internal.add_live_signal_triggers(regclass, text) FROM PUBLIC, anon, authenticated;--> statement-breakpoint

-- What the live screens show (Calendar, Today, My patients, the emergency banners), by how each
-- table reaches its centre. A hold expiring and calendar cells passing change no row; the screens'
-- own check every `live.connected_check_seconds` covers them.
CALL internal.add_live_signal_triggers('public.appointment', 'centre');--> statement-breakpoint
CALL internal.add_live_signal_triggers('public.slot_hold', 'centre');--> statement-breakpoint
CALL internal.add_live_signal_triggers('public.roster', 'centre');--> statement-breakpoint
CALL internal.add_live_signal_triggers('public.bill', 'centre');--> statement-breakpoint
CALL internal.add_live_signal_triggers('public.session', 'centre');--> statement-breakpoint
CALL internal.add_live_signal_triggers('public.opening_entry', 'centre');--> statement-breakpoint
CALL internal.add_live_signal_triggers('public.red_flag_alert', 'episode');--> statement-breakpoint
CALL internal.add_live_signal_triggers('public.ai_preparation_sheet', 'episode');--> statement-breakpoint
CALL internal.add_live_signal_triggers('public.plan_of_care', 'episode');--> statement-breakpoint
CALL internal.add_live_signal_triggers('public.plan_choice', 'episode');--> statement-breakpoint
CALL internal.add_live_signal_triggers('public.consent_record', 'link');--> statement-breakpoint
CALL internal.add_live_signal_triggers('public.consultation', 'link');--> statement-breakpoint
CALL internal.add_live_signal_triggers('public.patient_link', 'link');--> statement-breakpoint
CALL internal.add_live_signal_triggers('public.staff_leave', 'everywhere');--> statement-breakpoint

-- How often a live screen still checks while the relay is connected (TAD: 15 seconds); while it is
-- not, `live.refresh_seconds` as before (user decision, 31 October 2026).
SELECT set_config('audit.actor', 'system:migration', false);--> statement-breakpoint
INSERT INTO public.setting (key, value, updated_by) VALUES
  ('live.connected_check_seconds', '15', 'system:migration')
ON CONFLICT (key) DO NOTHING;--> statement-breakpoint
SELECT set_config('audit.actor', '', false);
