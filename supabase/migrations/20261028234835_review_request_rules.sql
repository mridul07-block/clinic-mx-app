-- PAT-09: review requests (PRD J7.3: "Google review requests are sent to every discharged patient,
-- never filtered by score"; PRD section 7: Fixed; Blueprint section 14: not conditional on a
-- positive rating; TAD jobs: "Discharge feedback and review request | Same day, then next day").
-- Recommended defaults chosen under the user's standing approval, 29 October 2026 (DECISION
-- PAT-09; docs/runbooks/feedback.md). Discharging any episode queues `whatsapp.review_request` for
-- the next day at 10:00 IST (settings), once per episode, whatever its feedback, score, reason or
-- consultation; WA-06 sends it with the centre's review link. Until then the desk shows the link as
-- a QR on a discharged episode's plan and payment sheet.

SELECT set_config('audit.actor', 'system:migration', false);--> statement-breakpoint
INSERT INTO public.setting (key, value, updated_by) VALUES
  ('feedback.review_request_days', '1', 'system:migration'),
  ('feedback.review_request_time', '"10:00"', 'system:migration')
ON CONFLICT (key) DO NOTHING;--> statement-breakpoint
SELECT set_config('audit.actor', '', false);--> statement-breakpoint

-- OUT-10 and OUT-11 as before; PAT-09 adds the review request, for every discharged episode.
CREATE OR REPLACE FUNCTION internal.episode_discharged_follow_up() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  days integer;
  at_time time;
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
  -- PAT-09: the review request, to every discharged patient, never filtered: the set day after
  -- discharge (IST) at the set time.
  SELECT (s.value #>> '{}')::int INTO days
    FROM public.setting s WHERE s.key = 'feedback.review_request_days';
  SELECT (s.value #>> '{}')::time INTO at_time
    FROM public.setting s WHERE s.key = 'feedback.review_request_time';
  INSERT INTO public.job (kind, payload, run_at, idempotency_key)
  VALUES ('whatsapp.review_request', jsonb_build_object('episodeId', NEW.id),
    greatest(
      (((coalesce(NEW.closed_at, now()) AT TIME ZONE 'Asia/Kolkata')::date + coalesce(days, 1))
        + coalesce(at_time, time '10:00')) AT TIME ZONE 'Asia/Kolkata',
      now()
    ),
    'whatsapp.review_request:' || NEW.id)
  ON CONFLICT (idempotency_key) DO NOTHING;
  RETURN NULL;
END;
$$;--> statement-breakpoint

-- Until WhatsApp sends it (WA-06), the desk shows the review link as a QR on a discharged
-- episode's plan and payment sheet: the episode's centre's link (null when none yet), for those
-- who check in at that centre.
CREATE OR REPLACE FUNCTION internal.review_link_target(p_episode_id uuid)
RETURNS TABLE (review_link text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT c.review_link
  FROM public.episode e
  JOIN public.centre c ON c.id = e.centre_id
  WHERE e.id = p_episode_id AND e.status = 'discharged'
    AND coalesce((SELECT internal.jwt_checks_in()), false)
    AND internal.jwt_sees_centre(e.centre_id)
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.review_link_target(uuid) FROM PUBLIC, anon;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION internal.review_link_target(uuid) TO authenticated;
