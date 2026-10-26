-- SCH-11: Book plan sessions (PRD J4.8; user decisions, 26 October 2026). The front desk books
-- the plan's remaining sessions at once from a weekly pattern; the series is a plan_booking row,
-- its appointments carry its id, and the database queues one WhatsApp plan sessions list for it
-- (staff cannot add jobs, as in ALT-04). Those who book at the centre (`bookings.manage`: the
-- Super Admin, Centre Managers, the front desk) read and record a series as themselves; nobody
-- changes or deletes one.
SELECT set_config('audit.actor', 'system:migration', false);--> statement-breakpoint
INSERT INTO public.setting (key, value, updated_by) VALUES
  ('booking.plan_clash_alternatives', '3', 'system:migration')
ON CONFLICT (key) DO NOTHING;--> statement-breakpoint
SELECT set_config('audit.actor', '', false);--> statement-breakpoint

CREATE TRIGGER audit_change AFTER INSERT OR UPDATE OR DELETE ON public.plan_booking
  FOR EACH ROW EXECUTE FUNCTION internal.audit_change();--> statement-breakpoint

CREATE POLICY plan_booking_read ON public.plan_booking FOR SELECT TO authenticated
  USING ((SELECT internal.jwt_edits_patients()) AND internal.jwt_sees_centre(centre_id));--> statement-breakpoint
CREATE POLICY plan_booking_record ON public.plan_booking FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT internal.jwt_edits_patients())
    AND internal.jwt_sees_centre(centre_id)
    AND booked_by = (SELECT internal.jwt_staff_id())
  );--> statement-breakpoint

-- Velyx support stays read only here too (IAM-08).
CREATE POLICY support_read_only_insert ON public.plan_booking AS RESTRICTIVE FOR INSERT
  TO authenticated WITH CHECK (NOT (SELECT internal.jwt_support()));--> statement-breakpoint
CREATE POLICY support_read_only_update ON public.plan_booking AS RESTRICTIVE FOR UPDATE
  TO authenticated USING (NOT (SELECT internal.jwt_support()))
  WITH CHECK (NOT (SELECT internal.jwt_support()));--> statement-breakpoint
CREATE POLICY support_read_only_delete ON public.plan_booking AS RESTRICTIVE FOR DELETE
  TO authenticated USING (NOT (SELECT internal.jwt_support()));--> statement-breakpoint

-- Kept as recorded: nobody signed in changes or deletes a series.
REVOKE UPDATE, DELETE, TRUNCATE ON public.plan_booking FROM authenticated;--> statement-breakpoint

-- A series is booked into an Active episode at its own centre, and the database stamps when.
CREATE OR REPLACE FUNCTION internal.plan_booking_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.episode e
    WHERE e.id = NEW.episode_id AND e.status = 'active' AND e.centre_id = NEW.centre_id
  ) THEN
    RAISE EXCEPTION 'Plan sessions are booked into an Active episode at its own centre'
      USING ERRCODE = 'check_violation';
  END IF;
  NEW.booked_at := clock_timestamp();
  RETURN NEW;
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.plan_booking_guard() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER plan_booking_guard BEFORE INSERT ON public.plan_booking
  FOR EACH ROW EXECUTE FUNCTION internal.plan_booking_guard();--> statement-breakpoint

-- One WhatsApp plan sessions list per series. Nothing is sent yet: the job completes without
-- sending until the WhatsApp tickets (WA-06) fill it in.
CREATE OR REPLACE FUNCTION internal.plan_sessions_list() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.job (kind, payload, idempotency_key)
  VALUES ('whatsapp.plan_sessions_list', jsonb_build_object('planBookingId', NEW.id),
    'whatsapp.plan_sessions_list:' || NEW.id)
  ON CONFLICT (idempotency_key) DO NOTHING;
  RETURN NULL;
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.plan_sessions_list() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER plan_sessions_list AFTER INSERT ON public.plan_booking
  FOR EACH ROW EXECUTE FUNCTION internal.plan_sessions_list();--> statement-breakpoint

-- An appointment of a series has the series' episode, centre, physio and type.
CREATE OR REPLACE FUNCTION internal.appointment_plan_booking() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.plan_booking b
    WHERE b.id = NEW.plan_booking_id
      AND b.episode_id IS NOT DISTINCT FROM NEW.episode_id
      AND b.centre_id = NEW.centre_id
      AND b.physio_id = NEW.physio_id
      AND b.appointment_type_id = NEW.appointment_type_id
  ) THEN
    RAISE EXCEPTION 'An appointment of a plan series has its episode, centre, physio and type'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.appointment_plan_booking() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER appointment_plan_booking BEFORE INSERT ON public.appointment
  FOR EACH ROW WHEN (NEW.plan_booking_id IS NOT NULL)
  EXECUTE FUNCTION internal.appointment_plan_booking();--> statement-breakpoint

-- The series link never changes, like the reschedule link (SCH-08).
CREATE OR REPLACE FUNCTION internal.appointment_fixed() RETURNS trigger
LANGUAGE plpgsql SET search_path = ''
AS $$
BEGIN
  IF (NEW.number, NEW.patient_id, NEW.centre_id, NEW.physio_id, NEW.appointment_type_id,
      NEW.starts_at, NEW.ends_at, NEW.channel, NEW.booked_by, NEW.machine, NEW.machine_unit,
      NEW.rescheduled_from_id, NEW.plan_booking_id)
    IS DISTINCT FROM
     (OLD.number, OLD.patient_id, OLD.centre_id, OLD.physio_id, OLD.appointment_type_id,
      OLD.starts_at, OLD.ends_at, OLD.channel, OLD.booked_by, OLD.machine, OLD.machine_unit,
      OLD.rescheduled_from_id, OLD.plan_booking_id) THEN
    RAISE EXCEPTION 'An appointment''s number, patient, place, physio, type and time never change; a reschedule books a new one'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint

-- The plan and payment sheet also needs the treating physio's id, to suggest them for the series.
DROP FUNCTION internal.plan_for_pricing(uuid);--> statement-breakpoint
CREATE FUNCTION internal.plan_for_pricing(episode_id uuid)
RETURNS TABLE (
  plan_of_care_id uuid,
  sessions_per_week integer,
  weeks integer,
  review_date date,
  treating_physio text,
  modalities jsonb,
  treating_physio_id uuid
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT p.id, p.sessions_per_week, p.weeks, p.review_date,
    (SELECT s.name FROM public.staff_user s WHERE s.id = p.treating_physio_id),
    coalesce(
      (SELECT jsonb_agg(jsonb_build_object('key', m.modality_key, 'name', coalesce(k.name, m.modality_key))
          ORDER BY coalesce(k.name, m.modality_key))
        FROM public.plan_modality m
        LEFT JOIN public.kb_modality k ON k.key = m.modality_key AND k.kb_version_id = c.kb_version_id
        WHERE m.plan_of_care_id = p.id),
      '[]'::jsonb),
    p.treating_physio_id
  FROM public.plan_of_care p
  JOIN public.episode e ON e.id = p.episode_id
  JOIN public.consultation c ON c.id = p.consultation_id
  WHERE p.episode_id = plan_for_pricing.episode_id
    AND (
      internal.jwt_staff_role() IN ('super_admin', 'finance')
      OR (internal.jwt_staff_role() = 'front_desk' AND internal.jwt_sees_centre(e.centre_id))
    )
  ORDER BY p.version DESC
  LIMIT 1
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.plan_for_pricing(uuid) FROM PUBLIC, anon;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION internal.plan_for_pricing(uuid) TO authenticated;
