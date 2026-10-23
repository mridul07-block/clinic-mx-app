-- INT-10: what a submitted health form leads to. The patient's submit queues one job, the
-- pipeline (`intake.submitted`), in the same transaction: a patient page may add only that job,
-- for its own visit, once its form is submitted. The pipeline runs as the system and writes red
-- flag alerts, precautions and notifications. Alerts and precautions are clinical: read by staff
-- who treat patients, at a centre they see. A notification is read, and marked read, by the staff
-- member it is for. Nobody else writes them; every change is audited.
CREATE TRIGGER audit_change AFTER INSERT OR UPDATE OR DELETE ON public.red_flag_alert
  FOR EACH ROW EXECUTE FUNCTION internal.audit_change();--> statement-breakpoint
CREATE TRIGGER audit_change AFTER INSERT OR UPDATE OR DELETE ON public.precaution
  FOR EACH ROW EXECUTE FUNCTION internal.audit_change();--> statement-breakpoint
CREATE TRIGGER audit_change AFTER INSERT OR UPDATE OR DELETE ON public.notification
  FOR EACH ROW EXECUTE FUNCTION internal.audit_change();--> statement-breakpoint

CREATE POLICY red_flag_alert_read ON public.red_flag_alert FOR SELECT TO authenticated
  USING (
    (SELECT internal.jwt_treats())
    AND EXISTS (
      SELECT 1 FROM public.episode e
      WHERE e.id = episode_id AND internal.jwt_sees_centre(e.centre_id)
    )
  );--> statement-breakpoint
CREATE POLICY precaution_read ON public.precaution FOR SELECT TO authenticated
  USING (
    (SELECT internal.jwt_treats())
    AND EXISTS (
      SELECT 1 FROM public.episode e
      WHERE e.id = episode_id AND internal.jwt_sees_centre(e.centre_id)
    )
  );--> statement-breakpoint

-- Staff change only when they read a notification.
REVOKE UPDATE ON public.notification FROM authenticated;--> statement-breakpoint
GRANT UPDATE (read_at) ON public.notification TO authenticated;--> statement-breakpoint
CREATE POLICY notification_read_own ON public.notification FOR SELECT TO authenticated
  USING (staff_user_id = (SELECT internal.jwt_staff_id()));--> statement-breakpoint
CREATE POLICY notification_mark_read ON public.notification FOR UPDATE TO authenticated
  USING (staff_user_id = (SELECT internal.jwt_staff_id()))
  WITH CHECK (staff_user_id = (SELECT internal.jwt_staff_id()));--> statement-breakpoint

-- The submit's job: only the pipeline, for the link's own visit, queued fresh, once the form is in.
GRANT INSERT ON public.job TO clinic_patient;--> statement-breakpoint
CREATE POLICY job_patient_intake_submitted ON public.job FOR INSERT TO clinic_patient
  WITH CHECK (
    kind = 'intake.submitted'
    AND payload = jsonb_build_object(
      'appointmentId',
      (SELECT l.appointment_id::text FROM public.patient_link l
       WHERE l.id = (SELECT internal.jwt_patient_link_id()) AND l.purpose = 'health_form')
    )
    AND idempotency_key = 'intake.submitted:' || (payload ->> 'appointmentId')
    AND status = 'queued'
    AND attempts = 0
    AND claimed_at IS NULL
    AND finished_at IS NULL
    AND last_error IS NULL
    AND run_at <= now()
    AND (SELECT internal.health_form_submitted((SELECT internal.jwt_patient_link_id())))
  );--> statement-breakpoint

-- Velyx support stays read only here too (IAM-08).
CREATE POLICY support_read_only_insert ON public.red_flag_alert AS RESTRICTIVE FOR INSERT
  TO authenticated WITH CHECK (NOT (SELECT internal.jwt_support()));--> statement-breakpoint
CREATE POLICY support_read_only_update ON public.red_flag_alert AS RESTRICTIVE FOR UPDATE
  TO authenticated USING (NOT (SELECT internal.jwt_support()))
  WITH CHECK (NOT (SELECT internal.jwt_support()));--> statement-breakpoint
CREATE POLICY support_read_only_delete ON public.red_flag_alert AS RESTRICTIVE FOR DELETE
  TO authenticated USING (NOT (SELECT internal.jwt_support()));--> statement-breakpoint
CREATE POLICY support_read_only_insert ON public.precaution AS RESTRICTIVE FOR INSERT
  TO authenticated WITH CHECK (NOT (SELECT internal.jwt_support()));--> statement-breakpoint
CREATE POLICY support_read_only_update ON public.precaution AS RESTRICTIVE FOR UPDATE
  TO authenticated USING (NOT (SELECT internal.jwt_support()))
  WITH CHECK (NOT (SELECT internal.jwt_support()));--> statement-breakpoint
CREATE POLICY support_read_only_delete ON public.precaution AS RESTRICTIVE FOR DELETE
  TO authenticated USING (NOT (SELECT internal.jwt_support()));--> statement-breakpoint
CREATE POLICY support_read_only_insert ON public.notification AS RESTRICTIVE FOR INSERT
  TO authenticated WITH CHECK (NOT (SELECT internal.jwt_support()));--> statement-breakpoint
CREATE POLICY support_read_only_update ON public.notification AS RESTRICTIVE FOR UPDATE
  TO authenticated USING (NOT (SELECT internal.jwt_support()))
  WITH CHECK (NOT (SELECT internal.jwt_support()));--> statement-breakpoint
CREATE POLICY support_read_only_delete ON public.notification AS RESTRICTIVE FOR DELETE
  TO authenticated USING (NOT (SELECT internal.jwt_support()));--> statement-breakpoint
CREATE POLICY support_read_only_insert ON public.job AS RESTRICTIVE FOR INSERT
  TO authenticated WITH CHECK (NOT (SELECT internal.jwt_support()));--> statement-breakpoint
CREATE POLICY support_read_only_update ON public.job AS RESTRICTIVE FOR UPDATE
  TO authenticated USING (NOT (SELECT internal.jwt_support()))
  WITH CHECK (NOT (SELECT internal.jwt_support()));--> statement-breakpoint
CREATE POLICY support_read_only_delete ON public.job AS RESTRICTIVE FOR DELETE
  TO authenticated USING (NOT (SELECT internal.jwt_support()));
