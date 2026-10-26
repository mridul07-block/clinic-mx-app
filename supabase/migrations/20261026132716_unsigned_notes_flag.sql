-- CLN-10: the unsigned notes flag (PRD J3.9; TAD job table: 9:00 PM IST daily). Each night's job
-- queues the next night itself (notes.unsigned_flag, keyed by its IST date); this queues the first
-- night: tonight, or tomorrow when 9 PM IST has passed. Queuing it again adds nothing.
SELECT set_config('audit.actor', 'system:migration', false);--> statement-breakpoint
INSERT INTO public.job (kind, payload, run_at, idempotency_key)
SELECT 'notes.unsigned_flag', jsonb_build_object('date', night::text),
  (night + time '21:00') AT TIME ZONE 'Asia/Kolkata', 'notes.unsigned_flag:' || night::text
FROM (
  SELECT CASE
    WHEN (now() AT TIME ZONE 'Asia/Kolkata')::time < time '21:00'
      THEN (now() AT TIME ZONE 'Asia/Kolkata')::date
    ELSE (now() AT TIME ZONE 'Asia/Kolkata')::date + 1
  END AS night
) tonight
ON CONFLICT (idempotency_key) DO NOTHING;--> statement-breakpoint
SELECT set_config('audit.actor', '', false);
