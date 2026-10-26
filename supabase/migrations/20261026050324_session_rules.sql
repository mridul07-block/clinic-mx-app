-- SES-03: the treatment session and its note (PRD J5.4, J5.5; TAD `session`; user decisions,
-- 26 October 2026). Its physio opens it on their own started Session or Zero Gravity Treadmill
-- visit (packages.session_appointment_types); who, where, its number in the episode and the plan
-- it follows come from the appointment, never from the caller. Its physio edits the note while it
-- is a draft and signs it with Close session, which stores the three pain readings, uses a session
-- of the episode's active package (oldest payment first; none, and it still closes: packages never
-- change care), completes the visit, and for new symptoms gives the episode's consultant a task. A
-- signed session never changes (rule 5). Clinicians at the episode's centre read it. Nobody
-- deletes. Every change is audited.
CREATE TRIGGER audit_change AFTER INSERT OR UPDATE OR DELETE ON public.session
  FOR EACH ROW EXECUTE FUNCTION internal.audit_change();--> statement-breakpoint

CREATE OR REPLACE FUNCTION internal.session_open() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  visit record;
  kinds jsonb := coalesce(
    (SELECT s.value FROM public.setting s WHERE s.key = 'packages.session_appointment_types'),
    '["session", "zero_gravity_treadmill"]');
BEGIN
  SELECT a.id, a.episode_id, a.patient_id, a.centre_id, a.physio_id, a.arrived_at, t.key AS type_key
    INTO visit
    FROM public.appointment a
    JOIN public.appointment_type t ON t.id = a.appointment_type_id
    WHERE a.id = NEW.appointment_id;
  IF NOT FOUND OR visit.episode_id IS NULL OR visit.arrived_at IS NULL THEN
    RAISE EXCEPTION 'A session opens on a checked in visit in an episode'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NOT kinds ? visit.type_key THEN
    RAISE EXCEPTION 'Only a session visit has a session note' USING ERRCODE = 'check_violation';
  END IF;
  NEW.episode_id := visit.episode_id;
  NEW.patient_id := visit.patient_id;
  NEW.centre_id := visit.centre_id;
  NEW.physio_id := visit.physio_id;
  -- Session n of the episode, as SES-01 counts it: by arrival, no shows and cancellations aside.
  NEW.number := 1 + (
    SELECT count(*)
    FROM public.appointment o
    JOIN public.appointment_type ot ON ot.id = o.appointment_type_id
    WHERE o.episode_id = visit.episode_id
      AND o.id <> visit.id
      AND kinds ? ot.key
      AND o.status IN ('checked_in', 'in_progress', 'completed')
      AND (o.arrived_at, o.id) < (visit.arrived_at, visit.id)
  );
  NEW.plan_of_care_id := (
    SELECT p.id FROM public.plan_of_care p
    WHERE p.episode_id = visit.episode_id ORDER BY p.version DESC LIMIT 1
  );
  NEW.status := 'draft';
  NEW.signed_by := NULL;
  NEW.signed_at := NULL;
  NEW.package_id := NULL;
  NEW.pain_rest := NULL;
  NEW.pain_activity := NULL;
  NEW.pain_after := NULL;
  NEW.version := 1;
  RETURN NEW;
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.session_open() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER session_open BEFORE INSERT ON public.session
  FOR EACH ROW EXECUTE FUNCTION internal.session_open();--> statement-breakpoint

CREATE OR REPLACE FUNCTION internal.session_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = ''
AS $$
DECLARE
  editable text[] := ARRAY['note', 'version', 'updated_at'];
  signing text[] := ARRAY['status', 'signed_by', 'signed_at', 'pain_rest', 'pain_activity',
    'pain_after', 'version', 'updated_at'];
BEGIN
  IF OLD.status = 'signed' THEN
    RAISE EXCEPTION 'A signed session note never changes; changes are addenda'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status = 'signed' THEN
    IF (to_jsonb(NEW) - signing) IS DISTINCT FROM (to_jsonb(OLD) - signing) THEN
      RAISE EXCEPTION 'Closing changes nothing but the status, who signed, when and the pain'
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.signed_by IS DISTINCT FROM NEW.physio_id
       OR (internal.jwt_staff_id() IS NOT NULL
           AND NEW.signed_by IS DISTINCT FROM internal.jwt_staff_id()) THEN
      RAISE EXCEPTION 'A session note is signed by its own physio'
        USING ERRCODE = 'check_violation';
    END IF;
    IF NOT internal.staff_treats(NEW.signed_by) THEN
      RAISE EXCEPTION 'Signing needs the Treats patients tick'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
  END IF;
  IF (to_jsonb(NEW) - editable) IS DISTINCT FROM (to_jsonb(OLD) - editable) THEN
    RAISE EXCEPTION 'Only the note of a session changes while it is a draft'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.session_guard() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER session_guard BEFORE UPDATE ON public.session
  FOR EACH ROW EXECUTE FUNCTION internal.session_guard();--> statement-breakpoint

-- Signing uses a session of the episode's active package, oldest payment first (BIL-08: active
-- means not cancelled, not used up, not past its last day in IST), and keeps which. Runs after
-- the guard (triggers fire by name), as the system: nobody signed in writes packages.
CREATE OR REPLACE FUNCTION internal.session_sign() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  held uuid;
BEGIN
  SELECT k.id INTO held
    FROM public.package k
    WHERE k.episode_id = NEW.episode_id
      AND k.cancelled_at IS NULL
      AND k.sessions_used < k.sessions_total
      AND k.valid_until >= (now() AT TIME ZONE 'Asia/Kolkata')::date
    ORDER BY k.paid_at, k.id
    LIMIT 1;
  IF held IS NOT NULL THEN
    PERFORM internal.use_package_session(held);
    NEW.package_id := held;
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.session_sign() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER session_sign BEFORE UPDATE ON public.session
  FOR EACH ROW WHEN (OLD.status = 'draft' AND NEW.status = 'signed')
  EXECUTE FUNCTION internal.session_sign();--> statement-breakpoint

-- Once signed: the visit is completed, and new symptoms become a task for the consultant who
-- signed the episode's consultation (a Centre Manager task at the centre when there is none).
CREATE OR REPLACE FUNCTION internal.session_closed() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  consultant uuid;
BEGIN
  UPDATE public.appointment a
    SET status = 'completed', completed_at = now(), updated_at = now()
    WHERE a.id = NEW.appointment_id AND a.status = 'in_progress';
  IF NEW.note #>> '{newSymptoms,answer}' = 'yes' THEN
    SELECT c.signed_by INTO consultant
      FROM public.consultation c
      WHERE c.episode_id = NEW.episode_id AND c.status = 'signed'
      ORDER BY c.signed_at DESC
      LIMIT 1;
    INSERT INTO public.task (kind, title, details, priority, assignee_staff_user_id,
      assignee_role, centre_id, patient_id, episode_id)
    VALUES ('review.new_symptoms',
      'New symptoms reported in session ' || NEW.number,
      jsonb_build_object('appointmentId', NEW.appointment_id, 'sessionId', NEW.id), 'high',
      consultant, CASE WHEN consultant IS NULL THEN 'centre_manager'::public.staff_role END,
      NEW.centre_id, NEW.patient_id, NEW.episode_id);
  END IF;
  RETURN NULL;
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.session_closed() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER session_closed AFTER UPDATE ON public.session
  FOR EACH ROW WHEN (OLD.status = 'draft' AND NEW.status = 'signed')
  EXECUTE FUNCTION internal.session_closed();--> statement-breakpoint

-- A physio completes their visit once its consultation or its session note is signed.
CREATE OR REPLACE FUNCTION internal.appointment_physio_change() RETURNS trigger
LANGUAGE plpgsql SET search_path = ''
AS $$
DECLARE
  starting text[] := ARRAY['status', 'started_at', 'started_by', 'updated_at'];
  completing text[] := ARRAY['status', 'completed_at', 'updated_at'];
BEGIN
  IF internal.jwt_staff_id() IS NULL OR internal.jwt_edits_patients() THEN
    RETURN NEW;
  END IF;
  IF OLD.status = 'checked_in' AND NEW.status = 'in_progress'
     AND (to_jsonb(NEW) - starting) = (to_jsonb(OLD) - starting) THEN
    RETURN NEW;
  END IF;
  IF OLD.status = 'in_progress' AND NEW.status = 'completed' AND NEW.completed_at IS NOT NULL
     AND (to_jsonb(NEW) - completing) = (to_jsonb(OLD) - completing)
     AND (
       EXISTS (
         SELECT 1 FROM public.consultation c
         WHERE c.appointment_id = NEW.id AND c.status = 'signed'
       )
       OR EXISTS (
         SELECT 1 FROM public.session s
         WHERE s.appointment_id = NEW.id AND s.status = 'signed'
       )
     ) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'A physio only starts their own checked in appointment, or completes it once its note is signed'
    USING ERRCODE = 'insufficient_privilege';
END;
$$;--> statement-breakpoint

CREATE POLICY session_read ON public.session FOR SELECT TO authenticated
  USING (
    session.physio_id = (SELECT internal.jwt_staff_id())
    OR ((SELECT internal.jwt_treats()) AND internal.jwt_sees_centre(session.centre_id))
  );--> statement-breakpoint
CREATE POLICY session_open ON public.session FOR INSERT TO authenticated
  WITH CHECK (
    session.physio_id = (SELECT internal.jwt_staff_id())
    AND (SELECT internal.jwt_treats())
    AND session.status = 'draft'
    AND EXISTS (
      SELECT 1 FROM public.appointment a
      WHERE a.id = session.appointment_id
        AND a.physio_id = session.physio_id
        AND a.status = 'in_progress'
    )
  );--> statement-breakpoint
CREATE POLICY session_save ON public.session FOR UPDATE TO authenticated
  USING (
    session.physio_id = (SELECT internal.jwt_staff_id())
    AND (SELECT internal.jwt_treats())
    AND session.status = 'draft'
  )
  WITH CHECK (
    session.physio_id = (SELECT internal.jwt_staff_id())
    AND session.status = 'draft'
  );--> statement-breakpoint
CREATE POLICY session_sign ON public.session FOR UPDATE TO authenticated
  USING (
    session.physio_id = (SELECT internal.jwt_staff_id())
    AND (SELECT internal.jwt_treats())
    AND session.status = 'draft'
  )
  WITH CHECK (
    session.physio_id = (SELECT internal.jwt_staff_id())
    AND session.signed_by = (SELECT internal.jwt_staff_id())
    AND session.status = 'signed'
  );--> statement-breakpoint

-- Velyx support stays read only here too (IAM-08).
CREATE POLICY support_read_only_insert ON public.session AS RESTRICTIVE FOR INSERT
  TO authenticated WITH CHECK (NOT (SELECT internal.jwt_support()));--> statement-breakpoint
CREATE POLICY support_read_only_update ON public.session AS RESTRICTIVE FOR UPDATE
  TO authenticated USING (NOT (SELECT internal.jwt_support()))
  WITH CHECK (NOT (SELECT internal.jwt_support()));--> statement-breakpoint
CREATE POLICY support_read_only_delete ON public.session AS RESTRICTIVE FOR DELETE
  TO authenticated USING (NOT (SELECT internal.jwt_support()));
