-- SCH-10: package reschedule allowance (PRD section 7: 1 per 10 booked sessions; Zero Gravity
-- Treadmill sessions never reschedulable; user decisions, 25 October 2026). A package session is
-- an appointment of a type in packages.session_appointment_types (Session, Zero Gravity Treadmill)
-- in an episode with an active package (not cancelled, sessions left, not past its last day). A
-- reschedule asked by the patient uses one of the package's reschedules (BIL-08 set them on
-- payment), and is refused when none is left or when the type is in
-- packages.never_reschedulable_items (matched by key: an appointment type's key is its price
-- item's). A move asked by the clinic never uses one and is always allowed. The database decides,
-- so the front desk and the WhatsApp Flow (WA-04) follow the same rule; a refusal stops the whole
-- reschedule.
SELECT set_config('audit.actor', 'system:migration', false);--> statement-breakpoint
INSERT INTO public.setting (key, value, updated_by) VALUES
  ('packages.session_appointment_types', '["session", "zero_gravity_treadmill"]', 'system:migration')
ON CONFLICT (key) DO NOTHING;--> statement-breakpoint
SELECT set_config('audit.actor', '', false);--> statement-breakpoint

CREATE OR REPLACE FUNCTION internal.package_reschedule() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  type_key text;
  held record;
BEGIN
  IF NEW.episode_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT t.key INTO type_key FROM public.appointment_type t WHERE t.id = NEW.appointment_type_id;
  IF NOT coalesce((SELECT s.value FROM public.setting s
      WHERE s.key = 'packages.session_appointment_types'), '["session", "zero_gravity_treadmill"]')
      ? type_key THEN
    RETURN NEW;
  END IF;
  SELECT k.id, k.reschedules_left INTO held
    FROM public.package k
    WHERE k.episode_id = NEW.episode_id
      AND k.cancelled_at IS NULL
      AND k.sessions_used < k.sessions_total
      AND k.valid_until >= (now() AT TIME ZONE 'Asia/Kolkata')::date
    ORDER BY k.paid_at DESC
    LIMIT 1
    FOR UPDATE;
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;
  IF coalesce((SELECT s.value FROM public.setting s
      WHERE s.key = 'packages.never_reschedulable_items'), '["zero_gravity_treadmill"]')
      ? type_key THEN
    RAISE EXCEPTION 'This package session cannot be rescheduled at the patient''s request'
      USING ERRCODE = 'check_violation';
  END IF;
  IF held.reschedules_left = 0 THEN
    RAISE EXCEPTION 'No reschedules left in this package' USING ERRCODE = 'check_violation';
  END IF;
  UPDATE public.package k SET reschedules_left = k.reschedules_left - 1 WHERE k.id = held.id;
  RETURN NEW;
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.package_reschedule() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER package_reschedule BEFORE UPDATE OF status ON public.appointment
  FOR EACH ROW WHEN (NEW.status = 'rescheduled' AND OLD.status IS DISTINCT FROM NEW.status
    AND NEW.change_reason = 'patient')
  EXECUTE FUNCTION internal.package_reschedule();
