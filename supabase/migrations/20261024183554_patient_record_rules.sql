-- CLN-12: the patient record. Signed records are part of the patient's record wherever they were
-- made (kickoff decision C1, user decision 24 October 2026): clinicians, meaning the Super Admin
-- and staff with the Treats patients tick (never Velyx support), read a signed consultation, its
-- rows, addenda, visit and health form at any centre, the patient's precautions, and the history
-- of their red flag alerts. Drafts keep their own rules; the alert list, the emergency banner and
-- every operational list keep their centre scope (red_flag_alert row level security is
-- unchanged). Each clinical open of the record is logged as a record view.

-- Whether the signed in person reads clinical records (`clinical.read`), at any centre.
CREATE OR REPLACE FUNCTION internal.jwt_clinical_reader() RETURNS boolean
LANGUAGE sql STABLE SET search_path = ''
AS $$
  SELECT (internal.jwt_staff_role() = 'super_admin' OR internal.jwt_treats())
    AND NOT internal.jwt_support()
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.jwt_clinical_reader() FROM PUBLIC, anon;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION internal.jwt_clinical_reader() TO authenticated;--> statement-breakpoint

-- Who reads a consultation's record: its consultant, clinicians who see the episode's centre,
-- and, once it is signed, clinicians at any centre.
CREATE OR REPLACE FUNCTION internal.reads_consultation(consultation_id uuid) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.consultation c
    JOIN public.episode e ON e.id = c.episode_id
    WHERE c.id = reads_consultation.consultation_id
      AND (
        c.physio_id = internal.jwt_staff_id()
        OR (internal.jwt_treats() AND internal.jwt_sees_centre(e.centre_id))
        OR (c.status = 'signed' AND internal.jwt_clinical_reader())
      )
  )
$$;--> statement-breakpoint

-- Addenda stay with the episode's centre (CLN-09): reading at any centre does not widen who adds
-- one, so the centre is tested here rather than through reads_consultation.
CREATE OR REPLACE FUNCTION internal.adds_addendum(consultation_id uuid, episode_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT internal.jwt_treats()
    AND internal.staff_treats(internal.jwt_staff_id())
    AND EXISTS (
      SELECT 1 FROM public.consultation c
      JOIN public.episode e ON e.id = c.episode_id
      WHERE c.id = adds_addendum.consultation_id
        AND c.episode_id = adds_addendum.episode_id
        AND c.status = 'signed'
        AND (c.physio_id = internal.jwt_staff_id() OR internal.jwt_sees_centre(e.centre_id))
    )
$$;--> statement-breakpoint

CREATE POLICY consultation_signed_record_read ON public.consultation FOR SELECT TO authenticated
  USING (consultation.status = 'signed' AND (SELECT internal.jwt_clinical_reader()));--> statement-breakpoint

CREATE POLICY precaution_record_read ON public.precaution FOR SELECT TO authenticated
  USING ((SELECT internal.jwt_clinical_reader()));--> statement-breakpoint

-- Names on a record made at another centre: who signed, wrote an addendum or treats, and the
-- centre. Clinicians read the name only; anyone else as staff_user and centre allow.
CREATE OR REPLACE FUNCTION internal.record_staff_name(staff_id uuid) RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT s.name FROM public.staff_user s
  WHERE s.id = record_staff_name.staff_id
    AND (
      internal.jwt_clinical_reader()
      OR s.id = internal.jwt_staff_id()
      OR internal.jwt_staff_role() = 'super_admin'
      OR internal.staff_in_seen_centre(s.id)
    )
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.record_staff_name(uuid) FROM PUBLIC, anon;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION internal.record_staff_name(uuid) TO authenticated;--> statement-breakpoint

CREATE OR REPLACE FUNCTION internal.record_centre_name(centre_id uuid) RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT c.name FROM public.centre c
  WHERE c.id = record_centre_name.centre_id
    AND (internal.jwt_clinical_reader() OR internal.jwt_sees_centre(c.id))
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.record_centre_name(uuid) FROM PUBLIC, anon;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION internal.record_centre_name(uuid) TO authenticated;--> statement-breakpoint

-- A patient's red flag alerts at every centre, newest first, for clinicians only; nothing for
-- anyone else. The alert list and banner still read red_flag_alert, which stays centre scoped.
CREATE OR REPLACE FUNCTION internal.patient_alert_history(patient_id uuid)
RETURNS TABLE (
  id uuid,
  episode_id uuid,
  centre_id uuid,
  name text,
  triage text,
  display text,
  status text,
  raised_at timestamptz,
  reviewed_by text,
  reviewed_at timestamptz,
  referred_to text,
  referred_by text,
  referred_at timestamptz,
  decision text,
  closed_by text,
  closed_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT a.id, a.episode_id, e.centre_id, a.name, a.triage::text, a.display::text, a.status::text,
    a.raised_at,
    (SELECT s.name FROM public.staff_user s WHERE s.id = a.reviewed_by), a.reviewed_at,
    a.referred_to,
    (SELECT s.name FROM public.staff_user s WHERE s.id = a.referred_by), a.referred_at,
    a.decision,
    (SELECT s.name FROM public.staff_user s WHERE s.id = a.closed_by), a.closed_at
  FROM public.red_flag_alert a
  JOIN public.episode e ON e.id = a.episode_id
  WHERE e.patient_id = patient_alert_history.patient_id
    AND internal.jwt_clinical_reader()
  ORDER BY a.raised_at DESC, a.id
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.patient_alert_history(uuid) FROM PUBLIC, anon;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION internal.patient_alert_history(uuid) TO authenticated;--> statement-breakpoint

-- A clinician opening a patient's record or someone else's signed consultation (PRD M16, C1):
-- written with the transaction's own audit actor and address, like internal.record_access_event,
-- so it cannot be recorded as anyone else. audit_event has no insert policy.
CREATE OR REPLACE FUNCTION internal.record_view(entity text, entity_id uuid) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  actor text := nullif(current_setting('audit.actor', true), '');
BEGIN
  IF actor IS NULL OR actor IS DISTINCT FROM 'staff:' || internal.jwt_staff_id()::text THEN
    RAISE EXCEPTION 'A record view is logged by the staff member viewing'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT internal.jwt_clinical_reader() THEN
    RAISE EXCEPTION 'Only clinicians view clinical records' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF entity NOT IN ('patient', 'consultation') THEN
    RAISE EXCEPTION 'Not a clinical record: %', entity USING ERRCODE = 'invalid_parameter_value';
  END IF;
  INSERT INTO public.audit_event (actor, action, entity, entity_id, ip)
  VALUES (actor, 'view', entity, entity_id::text, nullif(current_setting('audit.ip', true), ''));
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.record_view(text, uuid) FROM PUBLIC, anon;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION internal.record_view(text, uuid) TO authenticated;
