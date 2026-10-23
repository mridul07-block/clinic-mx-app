-- ALT-04: the no show workflow (PRD J5.12). When an appointment becomes No show, in the same
-- transaction: a call task for the front desk at its centre, the WhatsApp message queued as a job
-- (sent once WhatsApp exists; the sender checks it is still a no show), and, when the patient has
-- missed clinical.no_show_review_after appointments in a row with no clinical review open, a
-- clinical review task for the physio of the missed appointment (user decision 24 October 2026).
-- "In a row" counts the patient's no shows since their last attended appointment; cancelled and
-- rescheduled ones are skipped. The episode is never changed. When a no show is undone, the open
-- tasks it raised close with a decision, as whoever undid it. The counter is SCH-09's trigger.
SELECT set_config('audit.actor', 'system:migration', false);--> statement-breakpoint
INSERT INTO public.setting (key, value, updated_by) VALUES
  ('clinical.no_show_review_after', '2', 'system:migration')
ON CONFLICT (key) DO NOTHING;--> statement-breakpoint
SELECT set_config('audit.actor', '', false);--> statement-breakpoint

CREATE OR REPLACE FUNCTION internal.no_show_follow_up() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  actor uuid := internal.jwt_staff_id();
  review_after int;
  missed int;
BEGIN
  IF NEW.status = 'no_show' THEN
    INSERT INTO public.task (kind, title, details, priority, assignee_role, centre_id, patient_id,
      episode_id)
    VALUES ('call.no_show',
      'Call about the missed '
        || to_char(NEW.starts_at AT TIME ZONE 'Asia/Kolkata', 'FMHH12:MI AM "appointment on" Dy FMDD Mon'),
      jsonb_build_object('appointmentId', NEW.id), 'high', 'front_desk', NEW.centre_id,
      NEW.patient_id, NEW.episode_id);

    INSERT INTO public.job (kind, payload, idempotency_key)
    VALUES ('whatsapp.no_show', jsonb_build_object('appointmentId', NEW.id),
      'whatsapp.no_show:' || NEW.id)
    ON CONFLICT (idempotency_key) DO NOTHING;

    review_after := coalesce(
      (SELECT (s.value #>> '{}')::int FROM public.setting s
        WHERE s.key = 'clinical.no_show_review_after'), 2);
    SELECT count(*) INTO missed FROM public.appointment a
      WHERE a.patient_id = NEW.patient_id AND a.status = 'no_show'
        AND a.starts_at <= NEW.starts_at
        AND a.starts_at > coalesce(
          (SELECT max(b.starts_at) FROM public.appointment b
            WHERE b.patient_id = NEW.patient_id AND b.starts_at <= NEW.starts_at
              AND b.status IN ('checked_in', 'in_progress', 'completed')),
          '-infinity');
    IF missed >= review_after AND NOT EXISTS (
      SELECT 1 FROM public.task t
        WHERE t.patient_id = NEW.patient_id AND t.kind = 'review.no_shows' AND t.status = 'open'
    ) THEN
      INSERT INTO public.task (kind, title, details, priority, assignee_staff_user_id, centre_id,
        patient_id, episode_id)
      VALUES ('review.no_shows',
        'Clinical review: ' || missed || ' missed appointments in a row',
        jsonb_build_object('appointmentId', NEW.id, 'missed', missed), 'high', NEW.physio_id,
        NEW.centre_id, NEW.patient_id, NEW.episode_id);
    END IF;
  ELSIF OLD.status = 'no_show' THEN
    -- Undone: close what it raised, as the person undoing it (task_lifecycle checks the move).
    UPDATE public.task t
      SET status = 'closed',
        decision = 'Closed automatically: the no show was undone.',
        closed_by = actor,
        closed_at = now(),
        assignee_staff_user_id = coalesce(t.assignee_staff_user_id, actor),
        updated_at = now()
      WHERE t.status = 'open' AND t.details ->> 'appointmentId' = NEW.id::text;
  END IF;
  RETURN NULL;
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.no_show_follow_up() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER no_show_follow_up AFTER UPDATE OF status ON public.appointment
  FOR EACH ROW WHEN (NEW.status IS DISTINCT FROM OLD.status AND 'no_show' IN (NEW.status, OLD.status))
  EXECUTE FUNCTION internal.no_show_follow_up();
