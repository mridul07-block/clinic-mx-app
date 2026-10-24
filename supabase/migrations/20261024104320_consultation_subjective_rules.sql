-- CLN-03: the consultation's Subjective shows what the patient told us on the health form. Staff
-- read only a few columns of intake_response (the front desk sees whether it was sent, INT-11), so
-- the answers come through this function instead: only to the visit's own treating physio, only
-- once submitted, read only. The form never changes once submitted.
CREATE OR REPLACE FUNCTION internal.consultant_health_form(visit_id uuid)
RETURNS TABLE (form_version text, answers jsonb)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT r.form_version, r.answers
  FROM public.intake_response r
  JOIN public.appointment a ON a.id = r.appointment_id
  WHERE r.appointment_id = consultant_health_form.visit_id
    AND r.submitted_at IS NOT NULL
    AND a.physio_id = internal.jwt_staff_id()
    AND internal.jwt_treats()
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.consultant_health_form(uuid) FROM PUBLIC, anon;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION internal.consultant_health_form(uuid) TO authenticated;
