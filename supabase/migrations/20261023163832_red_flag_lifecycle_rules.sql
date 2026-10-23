-- ALT-01: a red flag alert's life. Raised by the health form (INT-10); then a clinician says "I'm
-- reviewing", may refer, and closes with a written decision. Read by clinicians, and by the Super
-- Admin and Centre Managers without the tick (PRD section 2), at centres they see. Only clinicians
-- change an alert, only its lifecycle columns, only by the allowed moves, as themselves. The
-- emergency banner reads open emergencies through a function that returns no clinical detail, so
-- the front desk sees "Clinician review needed" and nothing more. Velyx support reads none.
DROP POLICY red_flag_alert_read ON public.red_flag_alert;--> statement-breakpoint
CREATE POLICY red_flag_alert_read ON public.red_flag_alert FOR SELECT TO authenticated
  USING (
    ((SELECT internal.jwt_treats()) OR (SELECT internal.jwt_staff_role()) IN ('super_admin', 'centre_manager'))
    AND NOT (SELECT internal.jwt_support())
    AND EXISTS (
      SELECT 1 FROM public.episode e
      WHERE e.id = episode_id AND internal.jwt_sees_centre(e.centre_id)
    )
  );--> statement-breakpoint

REVOKE UPDATE ON public.red_flag_alert FROM authenticated;--> statement-breakpoint
GRANT UPDATE (status, reviewed_by, reviewed_at, referred_to, referred_by, referred_at, decision, closed_by, closed_at)
  ON public.red_flag_alert TO authenticated;--> statement-breakpoint
CREATE POLICY red_flag_alert_act ON public.red_flag_alert FOR UPDATE TO authenticated
  USING (
    (SELECT internal.jwt_treats())
    AND EXISTS (
      SELECT 1 FROM public.episode e
      WHERE e.id = episode_id AND internal.jwt_sees_centre(e.centre_id)
    )
  )
  WITH CHECK (
    (SELECT internal.jwt_treats())
    AND EXISTS (
      SELECT 1 FROM public.episode e
      WHERE e.id = episode_id AND internal.jwt_sees_centre(e.centre_id)
    )
  );--> statement-breakpoint

-- The moves of packages/schemas/src/red-flag-alerts.ts: raised to reviewed, reviewed to referred or
-- closed, referred to closed. Each records who (the signed in clinician) and when (now); what was
-- recorded before stays; a closed alert never changes.
CREATE OR REPLACE FUNCTION internal.red_flag_alert_lifecycle() RETURNS trigger
LANGUAGE plpgsql SET search_path = ''
AS $$
DECLARE
  actor uuid := internal.jwt_staff_id();
BEGIN
  IF OLD.status = 'closed' THEN
    RAISE EXCEPTION 'A closed alert does not change' USING ERRCODE = 'check_violation';
  END IF;
  IF NOT (OLD.status::text, NEW.status::text) IN (
    ('raised', 'reviewed'), ('reviewed', 'referred'), ('reviewed', 'closed'), ('referred', 'closed')
  ) THEN
    RAISE EXCEPTION 'An alert cannot go from % to %', OLD.status, NEW.status
      USING ERRCODE = 'check_violation';
  END IF;
  IF actor IS NULL THEN
    RAISE EXCEPTION 'Only a signed in clinician changes an alert' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status = 'reviewed' THEN
    IF NEW.reviewed_by IS DISTINCT FROM actor THEN
      RAISE EXCEPTION 'The reviewer is the signed in clinician' USING ERRCODE = 'check_violation';
    END IF;
    NEW.reviewed_at := now();
  ELSE
    NEW.reviewed_by := OLD.reviewed_by;
    NEW.reviewed_at := OLD.reviewed_at;
  END IF;
  IF NEW.status = 'referred' THEN
    IF NEW.referred_by IS DISTINCT FROM actor OR coalesce(btrim(NEW.referred_to), '') = '' THEN
      RAISE EXCEPTION 'A referral says where, by the signed in clinician' USING ERRCODE = 'check_violation';
    END IF;
    NEW.referred_at := now();
  ELSE
    NEW.referred_to := OLD.referred_to;
    NEW.referred_by := OLD.referred_by;
    NEW.referred_at := OLD.referred_at;
  END IF;
  IF NEW.status = 'closed' THEN
    IF NEW.closed_by IS DISTINCT FROM actor OR coalesce(btrim(NEW.decision), '') = '' THEN
      RAISE EXCEPTION 'Closing needs a written decision, by the signed in clinician' USING ERRCODE = 'check_violation';
    END IF;
    NEW.closed_at := now();
  ELSE
    NEW.decision := OLD.decision;
    NEW.closed_by := OLD.closed_by;
    NEW.closed_at := OLD.closed_at;
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.red_flag_alert_lifecycle() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER red_flag_alert_lifecycle BEFORE UPDATE ON public.red_flag_alert
  FOR EACH ROW EXECUTE FUNCTION internal.red_flag_alert_lifecycle();--> statement-breakpoint

-- The emergency banner: Raised emergency alerts at centres the caller sees, for every staff role
-- but Finance. No rule, no triage: SECURITY DEFINER so the front desk, who reads no alert, learns
-- only that a patient needs a clinician.
CREATE OR REPLACE FUNCTION internal.open_emergencies()
RETURNS TABLE (alert_id uuid, episode_id uuid, appointment_id uuid, patient_id uuid, centre_id uuid, raised_at timestamptz)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT a.id, a.episode_id, a.appointment_id, e.patient_id, e.centre_id, a.raised_at
  FROM public.red_flag_alert a
  JOIN public.episode e ON e.id = a.episode_id
  WHERE a.status = 'raised'
    AND a.display = 'emergency'
    AND internal.jwt_staff_role() IN ('super_admin', 'centre_manager', 'front_desk', 'physiotherapist')
    AND NOT internal.jwt_support()
    AND internal.jwt_sees_centre(e.centre_id)
  ORDER BY a.raised_at, a.id
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.open_emergencies() FROM PUBLIC, anon;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION internal.open_emergencies() TO authenticated;
