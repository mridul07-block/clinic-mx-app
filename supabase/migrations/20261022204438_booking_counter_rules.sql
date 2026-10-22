-- SCH-09: reschedule and no show counters (PRD J1.8). The database counts, so every path counts
-- the same way (front desk, WhatsApp Flow, the no show action): a change to Rescheduled asked by
-- the patient adds a reschedule (user decision 23 October 2026: one asked by the clinic never
-- counts); a change to No show, which the front desk confirms, adds a no show. Cancellations do
-- not count. A Centre Manager or the Super Admin lifts the block by setting both to zero.
CREATE OR REPLACE FUNCTION internal.count_booking_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF NEW.status = 'rescheduled' AND NEW.change_reason = 'patient' THEN
    INSERT INTO public.booking_counter (patient_id, reschedules) VALUES (NEW.patient_id, 1)
    ON CONFLICT (patient_id) DO UPDATE
      SET reschedules = public.booking_counter.reschedules + 1, updated_at = now();
  ELSIF NEW.status = 'no_show' THEN
    INSERT INTO public.booking_counter (patient_id, no_shows) VALUES (NEW.patient_id, 1)
    ON CONFLICT (patient_id) DO UPDATE
      SET no_shows = public.booking_counter.no_shows + 1, updated_at = now();
  END IF;
  RETURN NULL;
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.count_booking_change() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER count_booking_change AFTER UPDATE OF status ON public.appointment
  FOR EACH ROW WHEN (NEW.status IS DISTINCT FROM OLD.status)
  EXECUTE FUNCTION internal.count_booking_change();--> statement-breakpoint

CREATE TRIGGER audit_change AFTER INSERT OR UPDATE OR DELETE ON public.booking_counter
  FOR EACH ROW EXECUTE FUNCTION internal.audit_change();--> statement-breakpoint

-- Those who book read a patient's counts (patients are shared by the centres); only a Centre
-- Manager or the Super Admin lifts the block. Only the trigger adds rows.
CREATE POLICY booking_counter_read ON public.booking_counter FOR SELECT TO authenticated
  USING ((SELECT internal.jwt_edits_patients()));--> statement-breakpoint
CREATE POLICY booking_counter_lift ON public.booking_counter FOR UPDATE TO authenticated
  USING ((SELECT internal.jwt_staff_role()) IN ('super_admin', 'centre_manager'))
  WITH CHECK ((SELECT internal.jwt_staff_role()) IN ('super_admin', 'centre_manager'));--> statement-breakpoint

-- Velyx support stays read only here too (IAM-08).
CREATE POLICY support_read_only_insert ON public.booking_counter AS RESTRICTIVE FOR INSERT
  TO authenticated WITH CHECK (NOT (SELECT internal.jwt_support()));--> statement-breakpoint
CREATE POLICY support_read_only_delete ON public.booking_counter AS RESTRICTIVE FOR DELETE
  TO authenticated USING (NOT (SELECT internal.jwt_support()));--> statement-breakpoint
CREATE POLICY support_read_only_update ON public.booking_counter AS RESTRICTIVE FOR UPDATE
  TO authenticated USING (NOT (SELECT internal.jwt_support()))
  WITH CHECK (NOT (SELECT internal.jwt_support()));--> statement-breakpoint

-- What happened before the counters existed counts too.
SELECT set_config('audit.actor', 'system:migration', false);--> statement-breakpoint
INSERT INTO public.booking_counter (patient_id, reschedules, no_shows)
SELECT patient_id,
  count(*) FILTER (WHERE status = 'rescheduled' AND change_reason = 'patient'),
  count(*) FILTER (WHERE status = 'no_show')
FROM public.appointment
WHERE (status = 'rescheduled' AND change_reason = 'patient') OR status = 'no_show'
GROUP BY patient_id
ON CONFLICT (patient_id) DO NOTHING;--> statement-breakpoint
SELECT set_config('audit.actor', '', false);
