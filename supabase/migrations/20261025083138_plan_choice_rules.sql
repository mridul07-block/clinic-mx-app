-- BIL-02: the patient's choice on the recommended plan (PRD J4.3; user decisions, 25 October
-- 2026). Those who see bill amounts (`bills.view_amounts`: the Super Admin, Finance, the front
-- desk at the episode's centre) read and record choices; a choice is recorded only while the
-- episode is Plan proposed and only against its newest plan, by the person signed in, and nobody
-- changes or deletes one (the newest counts). No choice changes the episode (rule 1).
-- "I'll think about it" is followed up at billing.think_about_it_follow_up_time IST on the
-- billing.think_about_it_follow_up_days'th day after it was recorded: the database sets
-- follow_up_at and queues the follow up job (staff cannot add jobs, as in ALT-04); the job makes
-- the call task and queues the WhatsApp nudge only if the choice is still the newest.
SELECT set_config('audit.actor', 'system:migration', false);--> statement-breakpoint
INSERT INTO public.setting (key, value, updated_by) VALUES
  ('billing.think_about_it_follow_up_days', '2', 'system:migration'),
  ('billing.think_about_it_follow_up_time', '"10:00"', 'system:migration')
ON CONFLICT (key) DO NOTHING;--> statement-breakpoint
SELECT set_config('audit.actor', '', false);--> statement-breakpoint

CREATE TRIGGER audit_change AFTER INSERT OR UPDATE OR DELETE ON public.plan_choice
  FOR EACH ROW EXECUTE FUNCTION internal.audit_change();--> statement-breakpoint

-- Whether the signed in person prices this episode: the Super Admin, Finance, or the front desk at
-- its centre (as internal.plan_for_pricing).
CREATE OR REPLACE FUNCTION internal.prices_episode(episode_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.episode e
    WHERE e.id = prices_episode.episode_id
      AND (
        internal.jwt_staff_role() IN ('super_admin', 'finance')
        OR (internal.jwt_staff_role() = 'front_desk' AND internal.jwt_sees_centre(e.centre_id))
      )
  )
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.prices_episode(uuid) FROM PUBLIC, anon;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION internal.prices_episode(uuid) TO authenticated;--> statement-breakpoint

-- Whether a choice may be recorded now: the reader prices the episode, it is Plan proposed, and
-- the plan is its newest.
CREATE OR REPLACE FUNCTION internal.records_plan_choice(episode_id uuid, plan_of_care_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT internal.prices_episode(records_plan_choice.episode_id)
    AND EXISTS (
      SELECT 1 FROM public.episode e
      WHERE e.id = records_plan_choice.episode_id AND e.status = 'plan_proposed'
    )
    AND records_plan_choice.plan_of_care_id = (
      SELECT p.id FROM public.plan_of_care p
      WHERE p.episode_id = records_plan_choice.episode_id
      ORDER BY p.version DESC
      LIMIT 1
    )
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.records_plan_choice(uuid, uuid) FROM PUBLIC, anon;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION internal.records_plan_choice(uuid, uuid) TO authenticated;--> statement-breakpoint

CREATE POLICY plan_choice_read ON public.plan_choice FOR SELECT TO authenticated
  USING (internal.prices_episode(plan_choice.episode_id));--> statement-breakpoint
CREATE POLICY plan_choice_record ON public.plan_choice FOR INSERT TO authenticated
  WITH CHECK (
    plan_choice.recorded_by = (SELECT internal.jwt_staff_id())
    AND internal.records_plan_choice(plan_choice.episode_id, plan_choice.plan_of_care_id)
  );--> statement-breakpoint

-- Velyx support stays read only here too (IAM-08).
CREATE POLICY support_read_only_insert ON public.plan_choice AS RESTRICTIVE FOR INSERT
  TO authenticated WITH CHECK (NOT (SELECT internal.jwt_support()));--> statement-breakpoint
CREATE POLICY support_read_only_update ON public.plan_choice AS RESTRICTIVE FOR UPDATE
  TO authenticated USING (NOT (SELECT internal.jwt_support()))
  WITH CHECK (NOT (SELECT internal.jwt_support()));--> statement-breakpoint
CREATE POLICY support_read_only_delete ON public.plan_choice AS RESTRICTIVE FOR DELETE
  TO authenticated USING (NOT (SELECT internal.jwt_support()));--> statement-breakpoint

-- Kept as recorded: nobody signed in changes or deletes a choice.
REVOKE UPDATE, DELETE, TRUNCATE ON public.plan_choice FROM authenticated;--> statement-breakpoint

-- The database stamps when it was recorded and when "I'll think about it" is followed up, from
-- the settings, whatever the insert says.
CREATE OR REPLACE FUNCTION internal.plan_choice_times() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  follow_up_days int;
  follow_up_time time;
BEGIN
  -- The clock, not the transaction's start, so two choices in one transaction keep their order.
  NEW.recorded_at := clock_timestamp();
  IF NEW.choice = 'think_about_it' THEN
    follow_up_days := coalesce(
      (SELECT (s.value #>> '{}')::int FROM public.setting s
        WHERE s.key = 'billing.think_about_it_follow_up_days'), 2);
    follow_up_time := coalesce(
      (SELECT (s.value #>> '{}')::time FROM public.setting s
        WHERE s.key = 'billing.think_about_it_follow_up_time'), '10:00');
    NEW.follow_up_at := (((now() AT TIME ZONE 'Asia/Kolkata')::date + follow_up_days)
      + follow_up_time) AT TIME ZONE 'Asia/Kolkata';
  ELSE
    NEW.follow_up_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.plan_choice_times() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER plan_choice_times BEFORE INSERT ON public.plan_choice
  FOR EACH ROW EXECUTE FUNCTION internal.plan_choice_times();--> statement-breakpoint

-- "I'll think about it" queues its follow up, once per choice.
CREATE OR REPLACE FUNCTION internal.think_about_it_follow_up() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.job (kind, payload, run_at, idempotency_key)
  VALUES ('billing.think_about_it_follow_up', jsonb_build_object('choiceId', NEW.id),
    NEW.follow_up_at, 'billing.think_about_it_follow_up:' || NEW.id)
  ON CONFLICT (idempotency_key) DO NOTHING;
  RETURN NULL;
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.think_about_it_follow_up() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER think_about_it_follow_up AFTER INSERT ON public.plan_choice
  FOR EACH ROW WHEN (NEW.choice = 'think_about_it')
  EXECUTE FUNCTION internal.think_about_it_follow_up();
