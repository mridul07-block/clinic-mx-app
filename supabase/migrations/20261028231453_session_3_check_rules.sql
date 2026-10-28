-- PAT-06: the session 3 check (PRD J5.6: "Session 3 check message."; PRD M14; TAD jobs: "Session 3
-- check | After session 3 closes"; PRD J5.5: closing a session signs the note). Recommended defaults
-- chosen under the user's standing approval, 29 October 2026 (DECISION PAT-06;
-- docs/runbooks/feedback.md). A message only: signing the episode's session numbered
-- `feedback.session_check_number` (3) queues `whatsapp.session_3_check` at once, once per episode,
-- never for an opening entry's episode (SCH-13: numbering starts again at launch, so their third
-- session here is not early progress). It sends nothing until WA-06, which words it with the client.

SELECT set_config('audit.actor', 'system:migration', false);--> statement-breakpoint
INSERT INTO public.setting (key, value, updated_by) VALUES
  ('feedback.session_check_number', '3', 'system:migration')
ON CONFLICT (key) DO NOTHING;--> statement-breakpoint
SELECT set_config('audit.actor', '', false);--> statement-breakpoint

-- SECURITY DEFINER: the physio who signs adds no job themselves.
CREATE OR REPLACE FUNCTION internal.session_3_check() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  checked integer;
BEGIN
  SELECT (s.value #>> '{}')::int INTO checked
    FROM public.setting s WHERE s.key = 'feedback.session_check_number';
  IF NEW.number IS DISTINCT FROM coalesce(checked, 3)
    OR NOT internal.first_treatment_episode(NEW.episode_id) THEN
    RETURN NULL;
  END IF;
  INSERT INTO public.job (kind, payload, run_at, idempotency_key)
  VALUES ('whatsapp.session_3_check',
    jsonb_build_object('sessionId', NEW.id, 'episodeId', NEW.episode_id,
      'appointmentId', NEW.appointment_id),
    now(), 'whatsapp.session_3_check:' || NEW.episode_id)
  ON CONFLICT (idempotency_key) DO NOTHING;
  RETURN NULL;
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.session_3_check() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER session_3_check AFTER UPDATE OF status ON public.session
  FOR EACH ROW
  WHEN (OLD.status = 'draft' AND NEW.status = 'signed')
  EXECUTE FUNCTION internal.session_3_check();
