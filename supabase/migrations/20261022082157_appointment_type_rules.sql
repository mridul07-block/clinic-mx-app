-- SET-03: appointment types and their lengths, per type and per physio. Every signed in staff
-- member reads them (booking and the calendar need them); the Super Admin changes them
-- (settings.manage for types, staff.manage for a physio's own lengths; user decision 22 October
-- 2026). Nothing is deleted except a physio's own length, cleared back to the type's. Audited.

CREATE TRIGGER audit_change AFTER INSERT OR UPDATE OR DELETE ON public.appointment_type
  FOR EACH ROW EXECUTE FUNCTION internal.audit_change();--> statement-breakpoint
CREATE TRIGGER audit_change AFTER INSERT OR UPDATE OR DELETE ON public.physio_appointment_length
  FOR EACH ROW EXECUTE FUNCTION internal.audit_change();--> statement-breakpoint

CREATE POLICY appointment_type_read ON public.appointment_type FOR SELECT TO authenticated
  USING ((SELECT internal.jwt_staff_role()) IS NOT NULL);--> statement-breakpoint
CREATE POLICY appointment_type_insert ON public.appointment_type FOR INSERT TO authenticated
  WITH CHECK ((SELECT internal.jwt_staff_role()) = 'super_admin');--> statement-breakpoint
CREATE POLICY appointment_type_update ON public.appointment_type FOR UPDATE TO authenticated
  USING ((SELECT internal.jwt_staff_role()) = 'super_admin')
  WITH CHECK ((SELECT internal.jwt_staff_role()) = 'super_admin');--> statement-breakpoint

CREATE POLICY physio_appointment_length_read ON public.physio_appointment_length FOR SELECT
  TO authenticated USING ((SELECT internal.jwt_staff_role()) IS NOT NULL);--> statement-breakpoint
CREATE POLICY physio_appointment_length_insert ON public.physio_appointment_length FOR INSERT
  TO authenticated WITH CHECK ((SELECT internal.jwt_staff_role()) = 'super_admin');--> statement-breakpoint
CREATE POLICY physio_appointment_length_update ON public.physio_appointment_length FOR UPDATE
  TO authenticated USING ((SELECT internal.jwt_staff_role()) = 'super_admin')
  WITH CHECK ((SELECT internal.jwt_staff_role()) = 'super_admin');--> statement-breakpoint
CREATE POLICY physio_appointment_length_delete ON public.physio_appointment_length FOR DELETE
  TO authenticated USING ((SELECT internal.jwt_staff_role()) = 'super_admin');--> statement-breakpoint

-- Velyx support stays read only here too (IAM-08).
CREATE POLICY support_read_only_insert ON public.appointment_type AS RESTRICTIVE FOR INSERT
  TO authenticated WITH CHECK (NOT (SELECT internal.jwt_support()));--> statement-breakpoint
CREATE POLICY support_read_only_update ON public.appointment_type AS RESTRICTIVE FOR UPDATE
  TO authenticated USING (NOT (SELECT internal.jwt_support()))
  WITH CHECK (NOT (SELECT internal.jwt_support()));--> statement-breakpoint
CREATE POLICY support_read_only_delete ON public.appointment_type AS RESTRICTIVE FOR DELETE
  TO authenticated USING (NOT (SELECT internal.jwt_support()));--> statement-breakpoint
CREATE POLICY support_read_only_insert ON public.physio_appointment_length AS RESTRICTIVE FOR INSERT
  TO authenticated WITH CHECK (NOT (SELECT internal.jwt_support()));--> statement-breakpoint
CREATE POLICY support_read_only_update ON public.physio_appointment_length AS RESTRICTIVE FOR UPDATE
  TO authenticated USING (NOT (SELECT internal.jwt_support()))
  WITH CHECK (NOT (SELECT internal.jwt_support()));--> statement-breakpoint
CREATE POLICY support_read_only_delete ON public.physio_appointment_length AS RESTRICTIVE FOR DELETE
  TO authenticated USING (NOT (SELECT internal.jwt_support()));--> statement-breakpoint

SELECT set_config('audit.actor', 'system:migration', false);--> statement-breakpoint
-- The four types of PRD M2 (user decision 22 October 2026).
-- DECISION #2: Consultation 45 minutes until the client confirms.
-- Session 45 minutes (PRD section 7: 45 to 60 per the clinic website; per physio within it).
-- DECISION (SET-03 placeholders): Review 45 and Zero Gravity Treadmill 30 until the client confirms.
INSERT INTO public.appointment_type (key, name, minutes) VALUES
  ('consultation', 'Consultation', 45),
  ('session', 'Session', 45),
  ('review', 'Review', 45),
  ('zero_gravity_treadmill', 'Zero Gravity Treadmill', 30)
ON CONFLICT (key) DO NOTHING;--> statement-breakpoint

-- Decision G2: the calendar grid is 15 minutes, with no buffer; every length is whole slots.
INSERT INTO public.setting (key, value, updated_by) VALUES
  ('scheduling.slot_minutes', '15', 'system:migration')
ON CONFLICT (key) DO NOTHING;--> statement-breakpoint

-- The consultation and session lengths now live on the appointment types above, per physio
-- where set; the global copies, never read, are retired (audited).
DELETE FROM public.setting
  WHERE key IN ('scheduling.consultation_minutes', 'scheduling.session_minutes');--> statement-breakpoint
SELECT set_config('audit.actor', '', false);
