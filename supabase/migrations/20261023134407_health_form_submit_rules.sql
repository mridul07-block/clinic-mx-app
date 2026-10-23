-- INT-05: the health form screens. A patient page (as `clinic_patient`, with the link in its
-- claims) may add report photos to its own visit while the visit is on and the form is not yet
-- submitted, and read back only the reports it added; it reads the patient's sex and occupation
-- to start About you from the record; and it submits: the form's submit time is now, and its
-- health form link is completed, once, after the form is submitted. Every change is audited.
GRANT SELECT (id, appointment_id, patient_link_id, content_type, created_at), INSERT
  ON public.patient_report TO clinic_patient;--> statement-breakpoint
CREATE POLICY patient_report_patient_add ON public.patient_report FOR INSERT TO clinic_patient
  WITH CHECK (
    (patient_id, appointment_id, patient_link_id) = (
      SELECT l.patient_id, l.appointment_id, l.id FROM public.patient_link l
      WHERE l.id = (SELECT internal.jwt_patient_link_id()) AND l.purpose = 'health_form'
    )
    AND uploaded_by IS NULL
    AND EXISTS (
      SELECT 1 FROM public.appointment a
      WHERE a.id = appointment_id AND a.status IN ('checked_in', 'in_progress')
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.intake_response r
      WHERE r.appointment_id = patient_report.appointment_id AND r.submitted_at IS NOT NULL
    )
  );--> statement-breakpoint
CREATE POLICY patient_report_patient_read ON public.patient_report FOR SELECT TO clinic_patient
  USING (patient_link_id = (SELECT internal.jwt_patient_link_id()));--> statement-breakpoint

GRANT SELECT (sex, occupation) ON public.patient TO clinic_patient;--> statement-breakpoint

-- Saving as before; submitting sets the submit time to now, and nothing changes after.
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
    AND assisted_by IS NULL
    AND EXISTS (
      SELECT 1 FROM public.appointment a
      WHERE a.id = appointment_id AND a.status IN ('checked_in', 'in_progress')
    )
  );--> statement-breakpoint

-- Whether a link's health form is submitted. SECURITY DEFINER so the patient_link policy does not
-- run the intake_response policies, which read patient_link, again.
CREATE OR REPLACE FUNCTION internal.health_form_submitted(link_id uuid) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.intake_response r
    WHERE r.patient_link_id = health_form_submitted.link_id AND r.submitted_at IS NOT NULL
  )
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.health_form_submitted(uuid) FROM PUBLIC, anon;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION internal.health_form_submitted(uuid) TO clinic_patient;--> statement-breakpoint

-- The page's own health form link, still working, completes once its form is submitted.
GRANT UPDATE (completed_at) ON public.patient_link TO clinic_patient;--> statement-breakpoint
CREATE POLICY patient_link_patient_complete ON public.patient_link FOR UPDATE TO clinic_patient
  USING (
    id = (SELECT internal.jwt_patient_link_id())
    AND purpose = 'health_form'
    AND completed_at IS NULL
    AND revoked_at IS NULL
    AND expires_at > now()
  )
  WITH CHECK (
    id = (SELECT internal.jwt_patient_link_id())
    AND completed_at = now()
    AND (SELECT internal.health_form_submitted(id))
  );
