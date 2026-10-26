-- Adverse events (SES-06; PRD M9 and J7.2, SOP 15.2; user decisions 26 October 2026): ticked
-- under the session note's response with a description, and taken from the note when it is
-- signed, so nobody sets `session.adverse_event` themselves (`session_guard` keeps refusing it:
-- it is not among the signing columns). Closing a session with one gives the episode's consultant
-- a task and the Clinical Director a task.
--
-- DECISION SES-06: the Clinical Director is the Super Admin role until the clinic names one.

-- Signing (BEFORE draft to signed, after session_guard by name): the active package's session
-- (SES-03), and now the adverse event from the note.
CREATE OR REPLACE FUNCTION internal.session_sign() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  held uuid;
  adverse text;
BEGIN
  IF (NEW.note #>> '{response,adverseEvent,reported}') = 'true' THEN
    adverse := trim(coalesce(NEW.note #>> '{response,adverseEvent,description}', ''));
    IF adverse = '' THEN
      RAISE EXCEPTION 'Describe the adverse event.' USING ERRCODE = 'check_violation';
    END IF;
    NEW.adverse_event := adverse;
  ELSE
    NEW.adverse_event := NULL;
  END IF;
  SELECT k.id INTO held
    FROM public.package k
    WHERE k.episode_id = NEW.episode_id
      AND k.cancelled_at IS NULL
      AND k.sessions_used < k.sessions_total
      AND k.valid_until >= (now() AT TIME ZONE 'Asia/Kolkata')::date
    ORDER BY k.paid_at, k.id
    LIMIT 1;
  IF held IS NOT NULL THEN
    PERFORM internal.use_package_session(held);
    NEW.package_id := held;
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint

-- Once signed: the visit is completed; new symptoms become a task for the consultant who signed
-- the episode's consultation (a Centre Manager task at the centre when there is none); an adverse
-- event becomes such a task too, and one for the Clinical Director (DECISION SES-06).
CREATE OR REPLACE FUNCTION internal.session_closed() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  consultant uuid;
  details jsonb := jsonb_build_object('appointmentId', NEW.appointment_id, 'sessionId', NEW.id);
BEGIN
  UPDATE public.appointment a
    SET status = 'completed', completed_at = now(), updated_at = now()
    WHERE a.id = NEW.appointment_id AND a.status = 'in_progress';
  SELECT c.signed_by INTO consultant
    FROM public.consultation c
    WHERE c.episode_id = NEW.episode_id AND c.status = 'signed'
    ORDER BY c.signed_at DESC
    LIMIT 1;
  IF NEW.note #>> '{newSymptoms,answer}' = 'yes' THEN
    INSERT INTO public.task (kind, title, details, priority, assignee_staff_user_id,
      assignee_role, centre_id, patient_id, episode_id)
    VALUES ('review.new_symptoms',
      'New symptoms reported in session ' || NEW.number, details, 'high',
      consultant, CASE WHEN consultant IS NULL THEN 'centre_manager'::public.staff_role END,
      NEW.centre_id, NEW.patient_id, NEW.episode_id);
  END IF;
  IF NEW.adverse_event IS NOT NULL THEN
    INSERT INTO public.task (kind, title, details, priority, assignee_staff_user_id,
      assignee_role, centre_id, patient_id, episode_id)
    VALUES ('review.adverse_event',
      'Adverse event in session ' || NEW.number, details, 'high',
      consultant, CASE WHEN consultant IS NULL THEN 'centre_manager'::public.staff_role END,
      NEW.centre_id, NEW.patient_id, NEW.episode_id),
      ('review.adverse_event_director',
      'Adverse event in session ' || NEW.number || ': Clinical Director review', details, 'high',
      NULL, 'super_admin'::public.staff_role,
      NEW.centre_id, NEW.patient_id, NEW.episode_id);
  END IF;
  RETURN NULL;
END;
$$;
