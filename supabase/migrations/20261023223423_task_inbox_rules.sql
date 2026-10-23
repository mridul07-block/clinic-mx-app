-- ALT-03: the tasks inbox. A task for a person reaches that person; a task for a role reaches that
-- role at the task's centre (every centre when it has none), until someone takes it for
-- themselves; the Super Admin sees every task. Staff never create, delete or edit a task: they take
-- one ("Take it") and close it with a written decision, as themselves; a closed task never
-- changes. Tasks are made by the server as the system (jobs, and the tickets that add task kinds).
DROP POLICY task_read ON public.task;--> statement-breakpoint
DROP POLICY task_update ON public.task;--> statement-breakpoint
CREATE POLICY task_read ON public.task FOR SELECT TO authenticated
  USING (
    assignee_staff_user_id = (SELECT internal.jwt_staff_id())
    OR (
      assignee_staff_user_id IS NULL
      AND assignee_role::text = (SELECT internal.jwt_staff_role())
      AND (task.centre_id IS NULL OR internal.jwt_sees_centre(task.centre_id))
    )
    OR (SELECT internal.jwt_staff_role()) = 'super_admin'
  );--> statement-breakpoint
CREATE POLICY task_update ON public.task FOR UPDATE TO authenticated
  USING (
    assignee_staff_user_id = (SELECT internal.jwt_staff_id())
    OR (
      assignee_staff_user_id IS NULL
      AND assignee_role::text = (SELECT internal.jwt_staff_role())
      AND (task.centre_id IS NULL OR internal.jwt_sees_centre(task.centre_id))
    )
    OR (SELECT internal.jwt_staff_role()) = 'super_admin'
  )
  WITH CHECK (
    assignee_staff_user_id = (SELECT internal.jwt_staff_id())
    OR (SELECT internal.jwt_staff_role()) = 'super_admin'
  );--> statement-breakpoint

-- Supabase grants every right on public tables to authenticated; take them back, then allow only
-- the columns that taking and closing change.
REVOKE INSERT, UPDATE, DELETE ON public.task FROM authenticated;--> statement-breakpoint
GRANT UPDATE (status, decision, assignee_staff_user_id, taken_at, closed_by, closed_at, updated_at)
  ON public.task TO authenticated;--> statement-breakpoint

-- The moves: take (nobody to the signed in person, for a role task) and close (open to closed with
-- a written decision, by the signed in person). Each stamps who and when; a closed task never
-- changes. The system (no signed in person) may close a task with a decision, never reopen one.
CREATE OR REPLACE FUNCTION internal.task_lifecycle() RETURNS trigger
LANGUAGE plpgsql SET search_path = ''
AS $$
DECLARE
  actor uuid := internal.jwt_staff_id();
BEGIN
  IF OLD.status = 'closed' THEN
    RAISE EXCEPTION 'A closed task does not change' USING ERRCODE = 'check_violation';
  END IF;
  IF actor IS NULL THEN
    RETURN NEW;
  END IF;
  IF NEW.assignee_staff_user_id IS DISTINCT FROM OLD.assignee_staff_user_id THEN
    IF OLD.assignee_staff_user_id IS NOT NULL OR OLD.assignee_role IS NULL
      OR NEW.assignee_staff_user_id IS DISTINCT FROM actor THEN
      RAISE EXCEPTION 'Only an untaken role task is taken, by the signed in person'
        USING ERRCODE = 'check_violation';
    END IF;
    NEW.taken_at := now();
  ELSE
    NEW.taken_at := OLD.taken_at;
  END IF;
  IF NEW.status = 'closed' THEN
    IF NEW.closed_by IS DISTINCT FROM actor OR coalesce(btrim(NEW.decision), '') = '' THEN
      RAISE EXCEPTION 'Closing needs a written decision, by the signed in person'
        USING ERRCODE = 'check_violation';
    END IF;
    NEW.closed_at := now();
  ELSE
    NEW.decision := OLD.decision;
    NEW.closed_by := OLD.closed_by;
    NEW.closed_at := OLD.closed_at;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.task_lifecycle() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER task_lifecycle BEFORE UPDATE ON public.task
  FOR EACH ROW EXECUTE FUNCTION internal.task_lifecycle();
