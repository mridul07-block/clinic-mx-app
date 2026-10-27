-- OUT-10: discharge (PRD J6.6, J5.12 and decision 19; TAD: signing a discharge checks the tick at
-- the moment of signing and stores who signed). User decisions, 27 October 2026.

-- Only a consultant with the Treats patients tick, now, discharges; the database stamps who and
-- when. Nobody else, the system included, so no job ever discharges an episode. Who discharged is
-- set only by the discharge itself.
CREATE OR REPLACE FUNCTION internal.episode_discharge_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF NEW.status = 'discharged' AND OLD.status IS DISTINCT FROM 'discharged' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.staff_user s
      WHERE s.id = internal.jwt_staff_id() AND s.active AND s.consultant AND s.treats_patients
    ) THEN
      RAISE EXCEPTION 'An episode is discharged by a consultant with the Treats patients tick'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    NEW.discharged_by := internal.jwt_staff_id();
    NEW.closed_at := now();
  ELSIF NEW.discharged_by IS DISTINCT FROM OLD.discharged_by THEN
    RAISE EXCEPTION 'Who discharged an episode is stamped at discharge'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.episode_discharge_guard() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER episode_discharge_guard BEFORE UPDATE ON public.episode
  FOR EACH ROW EXECUTE FUNCTION internal.episode_discharge_guard();--> statement-breakpoint

-- Discharging cancels the episode's visits still booked ahead, as asked by the clinic, by the
-- consultant who discharged; an open lost to follow up task for it closes.
CREATE OR REPLACE FUNCTION internal.episode_discharged_follow_up() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  UPDATE public.appointment a
    SET status = 'cancelled', change_reason = 'clinic', changed_at = now(),
      changed_by = NEW.discharged_by, updated_at = now()
    WHERE a.episode_id = NEW.id AND a.status IN ('booked', 'confirmed') AND a.starts_at > now();
  UPDATE public.task t
    SET status = 'closed', decision = 'Closed automatically: the episode was discharged.',
      closed_by = NEW.discharged_by, closed_at = now(),
      assignee_staff_user_id = coalesce(t.assignee_staff_user_id, NEW.discharged_by),
      updated_at = now()
    WHERE t.episode_id = NEW.id AND t.kind = 'review.lost_to_follow_up' AND t.status = 'open';
  RETURN NULL;
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.episode_discharged_follow_up() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER episode_discharged_follow_up AFTER UPDATE OF status ON public.episode
  FOR EACH ROW WHEN (NEW.status = 'discharged' AND OLD.status IS DISTINCT FROM 'discharged')
  EXECUTE FUNCTION internal.episode_discharged_follow_up();--> statement-breakpoint

-- A physio changes appointments only to start or complete their own (SES-03); now also the
-- cancellations of the visits ahead when they discharge, as consultant, the episode they belong to.
CREATE OR REPLACE FUNCTION internal.appointment_physio_change() RETURNS trigger
LANGUAGE plpgsql SET search_path = ''
AS $$
DECLARE
  starting text[] := ARRAY['status', 'started_at', 'started_by', 'updated_at'];
  completing text[] := ARRAY['status', 'completed_at', 'updated_at'];
BEGIN
  IF internal.jwt_staff_id() IS NULL OR internal.jwt_edits_patients() THEN
    RETURN NEW;
  END IF;
  IF OLD.status = 'checked_in' AND NEW.status = 'in_progress'
     AND (to_jsonb(NEW) - starting) = (to_jsonb(OLD) - starting) THEN
    RETURN NEW;
  END IF;
  IF OLD.status = 'in_progress' AND NEW.status = 'completed' AND NEW.completed_at IS NOT NULL
     AND (to_jsonb(NEW) - completing) = (to_jsonb(OLD) - completing)
     AND (
       EXISTS (
         SELECT 1 FROM public.consultation c
         WHERE c.appointment_id = NEW.id AND c.status = 'signed'
       )
       OR EXISTS (
         SELECT 1 FROM public.session s
         WHERE s.appointment_id = NEW.id AND s.status = 'signed'
       )
     ) THEN
    RETURN NEW;
  END IF;
  -- OUT-10: discharging cancels the episode's visits ahead, as the consultant who discharged it
  -- in this transaction.
  IF OLD.status IN ('booked', 'confirmed') AND NEW.status = 'cancelled'
     AND NEW.change_reason = 'clinic' AND NEW.changed_by = internal.jwt_staff_id()
     AND EXISTS (
       SELECT 1 FROM public.episode e
       WHERE e.id = NEW.episode_id AND e.status = 'discharged'
         AND e.discharged_by = internal.jwt_staff_id() AND e.closed_at = now()
     ) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'A physio only starts their own checked in appointment, or completes it once its note is signed'
    USING ERRCODE = 'insufficient_privilege';
END;
$$;--> statement-breakpoint

-- Booking a Lost to follow up episode again returns it to where it paused (the machine's
-- `return`), on every booking path; its open lost to follow up task closes, as whoever booked
-- (the patient's own booking has nobody).
CREATE OR REPLACE FUNCTION internal.appointment_returns_lost_episode() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  actor uuid := internal.jwt_staff_id();
BEGIN
  UPDATE public.episode e
    SET status = e.paused_from, paused_from = NULL, updated_at = now()
    WHERE e.id = NEW.episode_id AND e.status = 'lost_to_follow_up';
  IF FOUND THEN
    UPDATE public.task t
      SET status = 'closed', decision = 'Closed automatically: booked again.',
        closed_by = actor, closed_at = now(),
        assignee_staff_user_id = coalesce(t.assignee_staff_user_id, actor),
        updated_at = now()
      WHERE t.episode_id = NEW.episode_id AND t.kind = 'review.lost_to_follow_up'
        AND t.status = 'open';
  END IF;
  RETURN NULL;
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.appointment_returns_lost_episode() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER appointment_returns_lost_episode AFTER INSERT ON public.appointment
  FOR EACH ROW WHEN (NEW.episode_id IS NOT NULL)
  EXECUTE FUNCTION internal.appointment_returns_lost_episode();--> statement-breakpoint

-- DECISION #19: the lost to follow up period is the client's; 30 days is a placeholder.
SELECT set_config('audit.actor', 'system:migration', false);--> statement-breakpoint
INSERT INTO public.setting (key, value, updated_by) VALUES
  ('clinical.lost_to_follow_up_days', '30', 'system:migration')
ON CONFLICT (key) DO NOTHING;--> statement-breakpoint

-- The daily check (episodes.lost_to_follow_up, keyed by its IST date) queues the next day itself;
-- this queues the first: today at 6:00 AM IST, or tomorrow once that has passed.
INSERT INTO public.job (kind, payload, run_at, idempotency_key)
SELECT 'episodes.lost_to_follow_up', jsonb_build_object('date', day::text),
  (day + time '06:00') AT TIME ZONE 'Asia/Kolkata', 'episodes.lost_to_follow_up:' || day::text
FROM (
  SELECT CASE
    WHEN (now() AT TIME ZONE 'Asia/Kolkata')::time < time '06:00'
      THEN (now() AT TIME ZONE 'Asia/Kolkata')::date
    ELSE (now() AT TIME ZONE 'Asia/Kolkata')::date + 1
  END AS day
) first_run
ON CONFLICT (idempotency_key) DO NOTHING;--> statement-breakpoint
SELECT set_config('audit.actor', '', false);
