-- SCH-13: opening entries for patients already in treatment (PRD section 3 phase 5 and section 10;
-- user decisions 27 October 2026). While launch.opening_entries_open is on, the active Super Admin
-- (never Velyx support) enters one per patient on an Active episode of theirs with no consultation,
-- naming a physio with the Treats patients tick at the centre, the sessions left and the expiry
-- (today or later, IST). The database makes the opening package from it (no type, bill or payment)
-- with its reschedules and expiry reminder as a bought package, and keeps it in step with a
-- correction until a session is used. A Session booked without an episode for a patient with
-- exactly one open (Active or Under review) episode joins it. Everything audited.

CREATE TRIGGER audit_change AFTER INSERT OR UPDATE OR DELETE ON public.opening_entry
  FOR EACH ROW EXECUTE FUNCTION internal.audit_change();--> statement-breakpoint

-- Read with the patient's centre: no amounts, only the physio, sessions and expiry.
CREATE POLICY opening_entry_read ON public.opening_entry FOR SELECT TO authenticated
  USING (internal.jwt_sees_centre(opening_entry.centre_id));--> statement-breakpoint
CREATE POLICY opening_entry_write ON public.opening_entry FOR INSERT TO authenticated
  WITH CHECK ((SELECT internal.jwt_staff_role()) = 'super_admin');--> statement-breakpoint
CREATE POLICY opening_entry_correct ON public.opening_entry FOR UPDATE TO authenticated
  USING ((SELECT internal.jwt_staff_role()) = 'super_admin')
  WITH CHECK ((SELECT internal.jwt_staff_role()) = 'super_admin');--> statement-breakpoint

-- Velyx support stays read only here too (IAM-08).
CREATE POLICY support_read_only_insert ON public.opening_entry AS RESTRICTIVE FOR INSERT
  TO authenticated WITH CHECK (NOT (SELECT internal.jwt_support()));--> statement-breakpoint
CREATE POLICY support_read_only_update ON public.opening_entry AS RESTRICTIVE FOR UPDATE
  TO authenticated USING (NOT (SELECT internal.jwt_support()))
  WITH CHECK (NOT (SELECT internal.jwt_support()));--> statement-breakpoint
CREATE POLICY support_read_only_delete ON public.opening_entry AS RESTRICTIVE FOR DELETE
  TO authenticated USING (NOT (SELECT internal.jwt_support()));--> statement-breakpoint

-- An entry is corrected, never removed.
REVOKE DELETE, TRUNCATE ON public.opening_entry FROM authenticated;--> statement-breakpoint

-- Who, when and what: the active Super Admin now, while entries are open, on the patient's own
-- Active episode without a consultation, a treating physio at the centre, an expiry not past; a
-- correction changes only the physio, sessions left and expiry, while the package is unused.
CREATE OR REPLACE FUNCTION internal.opening_entry_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  caller uuid := internal.jwt_staff_id();
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.staff_user s
    WHERE s.id = caller AND s.active AND s.role = 'super_admin' AND NOT s.velyx_support
  ) THEN
    RAISE EXCEPTION 'Opening entries are made by the Super Admin'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT coalesce((SELECT (s.value #>> '{}')::boolean FROM public.setting s
      WHERE s.key = 'launch.opening_entries_open'), false) THEN
    RAISE EXCEPTION 'Opening entries are closed' USING ERRCODE = 'check_violation';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.staff_user s
    JOIN public.staff_user_centre c ON c.staff_user_id = s.id AND c.centre_id = NEW.centre_id
    WHERE s.id = NEW.physio_id AND s.active AND s.treats_patients AND NOT s.velyx_support
  ) THEN
    RAISE EXCEPTION 'The physio treats patients at the centre' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.valid_until < (now() AT TIME ZONE 'Asia/Kolkata')::date THEN
    RAISE EXCEPTION 'The package expiry is in the past' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.episode e
      WHERE e.id = NEW.episode_id AND e.patient_id = NEW.patient_id
        AND e.centre_id = NEW.centre_id AND e.status = 'active'
    ) OR EXISTS (
      SELECT 1 FROM public.consultation c WHERE c.episode_id = NEW.episode_id
    ) THEN
      RAISE EXCEPTION 'An opening entry opens the patient''s Active episode at the centre, with no consultation'
        USING ERRCODE = 'check_violation';
    END IF;
    NEW.created_by := caller;
    NEW.created_at := now();
  ELSE
    IF (NEW.patient_id, NEW.episode_id, NEW.centre_id, NEW.created_by, NEW.created_at)
      IS DISTINCT FROM
       (OLD.patient_id, OLD.episode_id, OLD.centre_id, OLD.created_by, OLD.created_at) THEN
      RAISE EXCEPTION 'A correction changes only the physio, sessions left and expiry'
        USING ERRCODE = 'check_violation';
    END IF;
    -- Locked first: a session closing at the same time uses it, or this correction waits for it.
    PERFORM 1 FROM public.package p WHERE p.opening_entry_id = NEW.id FOR UPDATE;
    IF EXISTS (
      SELECT 1 FROM public.package p
      WHERE p.opening_entry_id = NEW.id AND (p.sessions_used > 0 OR p.cancelled_at IS NOT NULL)
    ) THEN
      RAISE EXCEPTION 'The opening package is in use; it is no longer corrected'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  NEW.updated_by := caller;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.opening_entry_guard() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER opening_entry_guard BEFORE INSERT OR UPDATE ON public.opening_entry
  FOR EACH ROW EXECUTE FUNCTION internal.opening_entry_guard();--> statement-breakpoint

-- The opening package, made with the entry and kept in step with a correction: the sessions left,
-- the reschedules a bought package of that size gets less those already used, the expiry and its
-- reminder (moved while queued, else queued again for the new expiry).
CREATE OR REPLACE FUNCTION internal.opening_package() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  per_ten int := coalesce((SELECT (s.value #>> '{}')::int FROM public.setting s
    WHERE s.key = 'packages.reschedules_per_10_sessions'), 1);
  reminder_days int := coalesce((SELECT (s.value #>> '{}')::int FROM public.setting s
    WHERE s.key = 'packages.expiry_reminder_days'), 14);
  reminder_time time := coalesce((SELECT (s.value #>> '{}')::time FROM public.setting s
    WHERE s.key = 'packages.expiry_reminder_time'), '10:00');
  made uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.package (patient_id, episode_id, centre_id, opening_entry_id, name,
      sessions_total, reschedules_left, paid_at, valid_until)
    VALUES (NEW.patient_id, NEW.episode_id, NEW.centre_id, NEW.id, 'Opening package',
      NEW.sessions_left, (NEW.sessions_left / 10) * per_ten, NEW.created_at, NEW.valid_until)
    RETURNING id INTO made;
    INSERT INTO public.job (kind, payload, run_at, idempotency_key)
    VALUES ('whatsapp.package_expiry_reminder', jsonb_build_object('packageId', made),
      greatest(now(),
        ((NEW.valid_until - reminder_days) + reminder_time) AT TIME ZONE 'Asia/Kolkata'),
      'package_expiry:' || made)
    ON CONFLICT (idempotency_key) DO NOTHING;
    RETURN NEW;
  END IF;
  UPDATE public.package p
    SET sessions_total = NEW.sessions_left,
      reschedules_left = greatest(0, (NEW.sessions_left / 10) * per_ten
        - greatest(0, (OLD.sessions_left / 10) * per_ten - p.reschedules_left)),
      valid_until = NEW.valid_until
    WHERE p.opening_entry_id = NEW.id
    RETURNING p.id INTO made;
  IF NEW.valid_until IS DISTINCT FROM OLD.valid_until THEN
    UPDATE public.job
      SET run_at = greatest(now(),
        ((NEW.valid_until - reminder_days) + reminder_time) AT TIME ZONE 'Asia/Kolkata')
      WHERE kind = 'whatsapp.package_expiry_reminder' AND payload ->> 'packageId' = made::text
        AND status = 'queued';
    IF NOT FOUND THEN
      INSERT INTO public.job (kind, payload, run_at, idempotency_key)
      VALUES ('whatsapp.package_expiry_reminder', jsonb_build_object('packageId', made),
        greatest(now(),
          ((NEW.valid_until - reminder_days) + reminder_time) AT TIME ZONE 'Asia/Kolkata'),
        'package_expiry:' || made || ':' || NEW.valid_until)
      ON CONFLICT (idempotency_key) DO NOTHING;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.opening_package() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER opening_package AFTER INSERT OR UPDATE ON public.opening_entry
  FOR EACH ROW EXECUTE FUNCTION internal.opening_package();--> statement-breakpoint

-- A Session (or treadmill) booked without an episode joins the patient's only open episode, so it
-- can start; with none, or more than one, it stays as booked.
CREATE OR REPLACE FUNCTION internal.appointment_joins_open_episode() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  open_episodes uuid[];
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.appointment_type t
    WHERE t.id = NEW.appointment_type_id
      AND coalesce(
        (SELECT s.value FROM public.setting s WHERE s.key = 'packages.session_appointment_types'),
        '["session", "zero_gravity_treadmill"]') ? t.key
  ) THEN
    RETURN NEW;
  END IF;
  SELECT array_agg(e.id) INTO open_episodes FROM public.episode e
  WHERE e.patient_id = NEW.patient_id AND e.status IN ('active', 'under_review');
  IF cardinality(open_episodes) = 1 THEN
    NEW.episode_id := open_episodes[1];
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.appointment_joins_open_episode() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER appointment_joins_open_episode BEFORE INSERT ON public.appointment
  FOR EACH ROW WHEN (NEW.episode_id IS NULL AND NEW.patient_id IS NOT NULL)
  EXECUTE FUNCTION internal.appointment_joins_open_episode();--> statement-breakpoint

SELECT set_config('audit.actor', 'system:migration', false);--> statement-breakpoint
INSERT INTO public.setting (key, value, updated_by) VALUES
  ('launch.opening_entries_open', 'true', 'system:migration')
ON CONFLICT (key) DO NOTHING;
