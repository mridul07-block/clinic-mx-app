-- OUT-11: the discharge report (PRD J6.5, J6.7; Frontend Specification section 11; TAD section 9:
-- built from the signed discharge). Discharging an episode that had a signed consultation queues,
-- in the same transaction, the report's generation and its WhatsApp message (sent once WhatsApp
-- exists). Each job's key names the episode, so it is made once. User decisions, 27 October 2026.
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
  -- OUT-11: the discharge report and its WhatsApp message, once there was a signed consultation.
  IF EXISTS (
    SELECT 1 FROM public.consultation c WHERE c.episode_id = NEW.id AND c.status = 'signed'
  ) THEN
    INSERT INTO public.job (kind, payload, idempotency_key)
    VALUES ('documents.discharge_report', jsonb_build_object('episodeId', NEW.id),
      'discharge_report:' || NEW.id)
    ON CONFLICT (idempotency_key) DO NOTHING;
    INSERT INTO public.job (kind, payload, idempotency_key)
    VALUES ('whatsapp.discharge_report', jsonb_build_object('episodeId', NEW.id),
      'whatsapp.discharge_report:' || NEW.id)
    ON CONFLICT (idempotency_key) DO NOTHING;
  END IF;
  RETURN NULL;
END;
$$;--> statement-breakpoint
