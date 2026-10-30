-- SET-07: the exercise library (PRD M7 "home programme from the exercise library", M13 "exercises
-- with videos"; TAD `kb_exercise` and the `exercise-media` bucket, "Patients via token; staff").
-- The Super Admin adds exercises with a default dose and a short video; an exercise never changes
-- but to be retired (with its replacement named), so a plan keeps the exercise it was written
-- with. Staff read the library; a patient reaches a video only for an exercise in their own plan,
-- through their My plan link. Recommended defaults chosen under the user's standing approval, 30
-- October 2026 (DECISION SET-07; docs/runbooks/exercise-library.md).

CREATE TRIGGER audit_change AFTER INSERT OR UPDATE OR DELETE ON public.exercise
  FOR EACH ROW EXECUTE FUNCTION internal.audit_change();--> statement-breakpoint

-- An exercise is added by the signed in person, now, active; afterwards it is only retired, once,
-- now, naming an active replacement or none; none is removed or emptied.
CREATE FUNCTION internal.exercise_guard() RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_OP IN ('DELETE', 'TRUNCATE') THEN
    RAISE EXCEPTION 'Library exercises are kept' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF internal.jwt_staff_id() IS NOT NULL THEN
      NEW.created_by := internal.jwt_staff_id();
    END IF;
    NEW.created_at := now();
    NEW.retired_at := NULL;
    NEW.replaced_by := NULL;
    RETURN NEW;
  END IF;
  IF OLD.retired_at IS NOT NULL THEN
    RAISE EXCEPTION 'A retired exercise never changes' USING ERRCODE = 'check_violation';
  END IF;
  IF (to_jsonb(NEW) - 'retired_at' - 'replaced_by')
      IS DISTINCT FROM (to_jsonb(OLD) - 'retired_at' - 'replaced_by')
    OR NEW.retired_at IS NULL
  THEN
    RAISE EXCEPTION 'An exercise is only retired; a change is a new exercise'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.replaced_by IS NOT NULL AND (NEW.replaced_by = NEW.id OR NOT EXISTS (
    SELECT 1 FROM public.exercise x WHERE x.id = NEW.replaced_by AND x.retired_at IS NULL
  )) THEN
    RAISE EXCEPTION 'An exercise is replaced by an active one' USING ERRCODE = 'check_violation';
  END IF;
  NEW.retired_at := now();
  RETURN NEW;
END
$$;--> statement-breakpoint
CREATE TRIGGER exercise_guard BEFORE INSERT OR UPDATE OR DELETE ON public.exercise
  FOR EACH ROW EXECUTE FUNCTION internal.exercise_guard();--> statement-breakpoint
CREATE TRIGGER exercise_no_truncate BEFORE TRUNCATE ON public.exercise
  FOR EACH STATEMENT EXECUTE FUNCTION internal.exercise_guard();--> statement-breakpoint

-- Staff read the library (the plan editor, the session note, the screen); only the Super Admin
-- (exercises.manage), never a Velyx support login, adds and retires.
CREATE POLICY exercise_read ON public.exercise FOR SELECT TO authenticated
  USING ((SELECT internal.jwt_staff_id()) IS NOT NULL);--> statement-breakpoint
CREATE POLICY exercise_insert ON public.exercise FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT internal.jwt_staff_role()) = 'super_admin' AND NOT (SELECT internal.jwt_support())
  );--> statement-breakpoint
CREATE POLICY exercise_retire ON public.exercise FOR UPDATE TO authenticated
  USING ((SELECT internal.jwt_staff_role()) = 'super_admin' AND NOT (SELECT internal.jwt_support()))
  WITH CHECK (
    (SELECT internal.jwt_staff_role()) = 'super_admin' AND NOT (SELECT internal.jwt_support())
  );--> statement-breakpoint
CREATE POLICY support_read_only_insert ON public.exercise AS RESTRICTIVE FOR INSERT
  TO authenticated WITH CHECK (NOT (SELECT internal.jwt_support()));--> statement-breakpoint
CREATE POLICY support_read_only_update ON public.exercise AS RESTRICTIVE FOR UPDATE
  TO authenticated USING (NOT (SELECT internal.jwt_support()))
  WITH CHECK (NOT (SELECT internal.jwt_support()));--> statement-breakpoint
CREATE POLICY support_read_only_delete ON public.exercise AS RESTRICTIVE FOR DELETE
  TO authenticated USING (NOT (SELECT internal.jwt_support()));--> statement-breakpoint
REVOKE ALL ON public.exercise FROM anon;--> statement-breakpoint
REVOKE DELETE, TRUNCATE ON public.exercise FROM authenticated;--> statement-breakpoint

-- The video of an exercise in the plan of the patient's own My plan link (the plan My plan
-- shows), for our server to fetch from the bucket; null otherwise.
CREATE FUNCTION internal.my_plan_exercise_video(of_exercise uuid) RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  WITH link AS (
    SELECT l.episode_id FROM public.patient_link l
    WHERE l.id = internal.jwt_patient_link_id()
      AND l.purpose = 'my_plan' AND l.episode_id IS NOT NULL
      AND l.revoked_at IS NULL AND l.expires_at > now()
  ),
  plan AS (
    SELECT p.home_programme
    FROM public.plan_of_care p JOIN link ON p.episode_id = link.episode_id
    ORDER BY p.version DESC LIMIT 1
  )
  SELECT jsonb_build_object('path', x.video_path, 'type', x.video_type, 'bytes', x.video_bytes)
  FROM plan
  JOIN public.exercise x ON x.id = of_exercise AND x.video_path IS NOT NULL
  WHERE EXISTS (
    SELECT 1 FROM jsonb_array_elements(plan.home_programme) e
    WHERE e ->> 'exerciseId' = of_exercise::text
  )
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.my_plan_exercise_video(uuid) FROM PUBLIC, anon, authenticated;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION internal.my_plan_exercise_video(uuid) TO clinic_patient;--> statement-breakpoint

-- The videos: private, MP4 or WebM, at most 4 MB (the hosted request limit; the setting
-- `exercises.video_max_mb` may be lower). Only our server reaches the bucket, with the service
-- role (rule 9).
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('exercise-media', 'exercise-media', false, 4000000, ARRAY['video/mp4', 'video/webm'])
ON CONFLICT (id) DO NOTHING;--> statement-breakpoint

-- DECISION SET-07: videos up to 4 MB, short clips filmed for phones.
SELECT set_config('audit.actor', 'system:migration', false);--> statement-breakpoint
INSERT INTO public.setting (key, value, updated_by) VALUES
  ('exercises.video_max_mb', '4', 'system:migration')
ON CONFLICT (key) DO NOTHING;--> statement-breakpoint
SELECT set_config('audit.actor', '', false);
