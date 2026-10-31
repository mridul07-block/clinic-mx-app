-- WA-10: the emergency reply (PRD J1.9). The advice a message with an emergency phrase gets first,
-- a setting (DECISION WA-10: the standard safety text until the clinical director confirms it).
SELECT set_config('audit.actor', 'system:migration', false);--> statement-breakpoint
INSERT INTO public.setting (key, value, updated_by) VALUES
  ('whatsapp.emergency_advice',
   '"If this is a medical emergency, call 112 or go to the nearest hospital emergency department now. Do not wait for a reply here."',
   'system:migration')
ON CONFLICT (key) DO NOTHING;--> statement-breakpoint
SELECT set_config('audit.actor', '', false);--> statement-breakpoint

-- The number to call back on an emergency task's card: the sender of the message the task names.
-- The task keeps only the message's id (no phone numbers in task details), and only the Super Admin
-- reads messages, so this reads it as the owner, for a `call.emergency` task the caller may read
-- (the conditions of the `task_read` policy); anything else is null. Never for a Velyx support
-- login, which `message_read` keeps from messages too. The id is cast under the kind test, so the
-- message's primary key is used and another kind's details are never cast.
CREATE OR REPLACE FUNCTION internal.task_call_back_phone(task_id uuid) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT m.from_phone
  FROM public.task t
  JOIN public.message m ON m.id = CASE WHEN t.kind = 'call.emergency'
    THEN (t.details ->> 'messageId')::uuid END
  WHERE t.id = task_id
    AND t.kind = 'call.emergency'
    AND m.direction = 'inbound'
    AND NOT internal.jwt_support()
    AND (
      t.assignee_staff_user_id = internal.jwt_staff_id()
      OR (
        t.assignee_staff_user_id IS NULL
        AND t.assignee_role::text = internal.jwt_staff_role()
        AND (t.centre_id IS NULL OR internal.jwt_sees_centre(t.centre_id))
      )
      OR internal.jwt_staff_role() = 'super_admin'
    )
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.task_call_back_phone(uuid) FROM PUBLIC, anon;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION internal.task_call_back_phone(uuid) TO authenticated;
