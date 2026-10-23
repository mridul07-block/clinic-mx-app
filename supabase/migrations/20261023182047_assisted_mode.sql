-- INT-09: assisted mode (PRD J2.5). A staff member who checks patients in presses "Fill in with the
-- patient" in the check in drawer: they are recorded as the helper of that visit's health form,
-- as themselves, while the visit is checked in at a centre they see and the form is not sent
-- (`internal.mark_health_form_assisted`).
-- Staff read only who helped and whether it was sent, never the answers. The patient can no
-- longer change who helped: their updates are limited to the answers, the screens done and the
-- submit (user decisions, 23 October 2026).
REVOKE UPDATE ON public.intake_response FROM clinic_patient;--> statement-breakpoint
GRANT UPDATE (answers, done_screens, submitted_at, updated_at) ON public.intake_response TO clinic_patient;--> statement-breakpoint
DROP POLICY intake_response_patient_save ON public.intake_response;--> statement-breakpoint
CREATE POLICY intake_response_patient_save ON public.intake_response FOR UPDATE TO clinic_patient
  USING (
    (appointment_id, patient_id) = (
      SELECT l.appointment_id, l.patient_id FROM public.patient_link l
      WHERE l.id = (SELECT internal.jwt_patient_link_id()) AND l.purpose = 'health_form'
    )
    AND submitted_at IS NULL
  )
  WITH CHECK (
    (appointment_id, patient_id) = (
      SELECT l.appointment_id, l.patient_id FROM public.patient_link l
      WHERE l.id = (SELECT internal.jwt_patient_link_id()) AND l.purpose = 'health_form'
    )
    AND (submitted_at IS NULL OR submitted_at = now())
    AND EXISTS (
      SELECT 1 FROM public.appointment a
      WHERE a.id = appointment_id AND a.status IN ('checked_in', 'in_progress')
    )
  );--> statement-breakpoint

-- Who helped, and whether it was sent: for those who check in, and for clinicians, at the visit's
-- centre. No other column: the default table grants go first, so only these columns remain.
REVOKE SELECT, INSERT, UPDATE, DELETE ON public.intake_response FROM authenticated;--> statement-breakpoint
GRANT SELECT (id, appointment_id, patient_id, assisted_by, submitted_at) ON public.intake_response
  TO authenticated;--> statement-breakpoint
CREATE POLICY intake_response_staff_read ON public.intake_response FOR SELECT TO authenticated
  USING (
    ((SELECT internal.jwt_checks_in()) OR (SELECT internal.jwt_treats()))
    AND EXISTS (
      SELECT 1 FROM public.appointment a
      WHERE a.id = intake_response.appointment_id AND internal.jwt_sees_centre(a.centre_id)
    )
  );--> statement-breakpoint

-- Marking who helps is one function, not table rights: it checks everything, records the signed in
-- staff member only, and touches nothing but who helped. SECURITY DEFINER, so staff need no write
-- right on the table at all; the audit trigger still names them (the transaction's audit actor).
-- True when marked; false when refused (not someone who checks in, support, the visit not checked
-- in at a centre they see, the link not the visit's health form link, or the form already sent).
CREATE OR REPLACE FUNCTION internal.mark_health_form_assisted(visit_id uuid, link_id uuid, version text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  helper uuid := internal.jwt_staff_id();
  visit_patient uuid;
BEGIN
  IF helper IS NULL OR NOT coalesce(internal.jwt_checks_in(), false) OR internal.jwt_support() THEN
    RETURN false;
  END IF;
  SELECT a.patient_id INTO visit_patient
  FROM public.appointment a
  JOIN public.patient_link l ON l.appointment_id = a.id AND l.purpose = 'health_form'
  WHERE a.id = mark_health_form_assisted.visit_id
    AND l.id = mark_health_form_assisted.link_id
    AND a.status = 'checked_in'
    AND internal.jwt_sees_centre(a.centre_id);
  IF visit_patient IS NULL THEN
    RETURN false;
  END IF;
  INSERT INTO public.intake_response AS r (appointment_id, patient_id, patient_link_id, form_version, assisted_by)
  VALUES (mark_health_form_assisted.visit_id, visit_patient, mark_health_form_assisted.link_id,
    mark_health_form_assisted.version, helper)
  ON CONFLICT (appointment_id) DO UPDATE SET assisted_by = helper, updated_at = now()
    WHERE r.submitted_at IS NULL;
  RETURN FOUND;
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.mark_health_form_assisted(uuid, uuid, text) FROM PUBLIC, anon;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION internal.mark_health_form_assisted(uuid, uuid, text) TO authenticated;
