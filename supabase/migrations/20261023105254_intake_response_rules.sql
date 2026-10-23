-- INT-04: the health form, saved after every screen. A patient page (as `clinic_patient`, with the
-- link in its claims) reads and writes only the form of its own health form link's visit, only
-- while that visit is on (Checked in or In consultation, INT-03) and never once submitted. The
-- patient never sets who helped or the submit time here. Staff reads come with the consultation
-- and the submit pipeline (INT-10); nobody deletes. Every change is audited.
CREATE TRIGGER audit_change AFTER INSERT OR UPDATE OR DELETE ON public.intake_response
  FOR EACH ROW EXECUTE FUNCTION internal.audit_change();--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE ON public.intake_response TO clinic_patient;--> statement-breakpoint

-- The page's own form: the visit and patient of its health form link.
CREATE POLICY intake_response_patient_read ON public.intake_response FOR SELECT TO clinic_patient
  USING (
    (appointment_id, patient_id) = (
      SELECT l.appointment_id, l.patient_id FROM public.patient_link l
      WHERE l.id = (SELECT internal.jwt_patient_link_id()) AND l.purpose = 'health_form'
    )
  );--> statement-breakpoint
CREATE POLICY intake_response_patient_start ON public.intake_response FOR INSERT TO clinic_patient
  WITH CHECK (
    (appointment_id, patient_id, patient_link_id) = (
      SELECT l.appointment_id, l.patient_id, l.id FROM public.patient_link l
      WHERE l.id = (SELECT internal.jwt_patient_link_id()) AND l.purpose = 'health_form'
    )
    AND submitted_at IS NULL
    AND assisted_by IS NULL
    AND EXISTS (
      SELECT 1 FROM public.appointment a
      WHERE a.id = appointment_id AND a.status IN ('checked_in', 'in_progress')
    )
  );--> statement-breakpoint
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
    AND submitted_at IS NULL
    AND assisted_by IS NULL
    AND EXISTS (
      SELECT 1 FROM public.appointment a
      WHERE a.id = appointment_id AND a.status IN ('checked_in', 'in_progress')
    )
  );--> statement-breakpoint

-- Velyx support stays read only here too (IAM-08).
CREATE POLICY support_read_only_insert ON public.intake_response AS RESTRICTIVE FOR INSERT
  TO authenticated WITH CHECK (NOT (SELECT internal.jwt_support()));--> statement-breakpoint
CREATE POLICY support_read_only_update ON public.intake_response AS RESTRICTIVE FOR UPDATE
  TO authenticated USING (NOT (SELECT internal.jwt_support()))
  WITH CHECK (NOT (SELECT internal.jwt_support()));--> statement-breakpoint
CREATE POLICY support_read_only_delete ON public.intake_response AS RESTRICTIVE FOR DELETE
  TO authenticated USING (NOT (SELECT internal.jwt_support()));
