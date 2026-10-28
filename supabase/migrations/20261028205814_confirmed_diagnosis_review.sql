-- AI-05 review: a diagnosis is confirmed at review or discharge, "not the first impression" (PRD
-- section 6), so only once the episode has been reviewed: it is Under review or discharged, its
-- session 4 reassessment (OUT-05) is signed, or its final testing (OUT-07) is signed. Before that
-- the guard refuses a confirmation, which would otherwise be stamped At review on the day of the
-- consultation. Recommended default chosen under the user's standing approval, 29 October 2026
-- (DECISION AI-05; docs/runbooks/ai-similar-cases.md).
CREATE OR REPLACE FUNCTION internal.episode_reviewed(episode_id uuid) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.episode e
    WHERE e.id = episode_reviewed.episode_id AND e.status IN ('under_review', 'discharged')
  ) OR EXISTS (
    SELECT 1 FROM public.reassessment r
    WHERE r.episode_id = episode_reviewed.episode_id AND r.signed_at IS NOT NULL
  ) OR EXISTS (
    SELECT 1 FROM public.final_test f WHERE f.episode_id = episode_reviewed.episode_id
  )
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.episode_reviewed(uuid) FROM PUBLIC, anon;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION internal.episode_reviewed(uuid) TO authenticated;--> statement-breakpoint

CREATE OR REPLACE FUNCTION internal.confirmed_diagnosis_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  signed_id uuid;
  signed_version uuid;
  episode_status text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.staff_user s
    WHERE s.id = internal.jwt_staff_id() AND s.active AND s.consultant AND s.treats_patients
      AND NOT s.velyx_support
  ) THEN
    RAISE EXCEPTION 'A diagnosis is confirmed by a consultant with the Treats patients tick'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT d.id, d.kb_version_id INTO signed_id, signed_version
  FROM public.diagnosis d
  JOIN public.consultation c ON c.id = d.consultation_id
  WHERE d.episode_id = NEW.episode_id AND c.status = 'signed'
  ORDER BY c.signed_at DESC, c.id DESC
  LIMIT 1;
  IF signed_id IS NULL
    OR NEW.source_diagnosis_id IS DISTINCT FROM signed_id
    OR NEW.kb_version_id IS DISTINCT FROM signed_version THEN
    RAISE EXCEPTION 'A diagnosis is confirmed against the episode''s latest signed diagnosis, in its knowledge base version'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NOT internal.episode_reviewed(NEW.episode_id) THEN
    RAISE EXCEPTION 'A diagnosis is confirmed at review or discharge, not before'
      USING ERRCODE = 'check_violation';
  END IF;
  SELECT e.status::text INTO episode_status FROM public.episode e WHERE e.id = NEW.episode_id;
  NEW.stage := CASE WHEN episode_status = 'discharged' THEN 'discharge' ELSE 'review' END;
  NEW.confirmed_by := internal.jwt_staff_id();
  -- The statement's own moment, so two confirmations in one transaction still order.
  NEW.confirmed_at := clock_timestamp();
  RETURN NEW;
END;
$$;
