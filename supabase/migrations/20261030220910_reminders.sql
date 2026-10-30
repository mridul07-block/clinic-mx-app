-- WA-08: the appointment reminders (PRD J1.6; TAD section 8: the day before reminder at
-- reminders.day_before_time, 6:00 PM IST, and the morning reminder at 8:00 AM IST on the day).
-- Each is a daily job keyed by the appointments' IST date that queues its next run itself; this
-- queues the first of each. Queuing them again adds nothing.
SELECT set_config('audit.actor', 'system:migration', false);--> statement-breakpoint
INSERT INTO public.setting (key, value, updated_by) VALUES
  ('reminders.morning_time', '"08:00"', 'system:migration')
ON CONFLICT (key) DO NOTHING;--> statement-breakpoint

-- The day before run for the appointments of `day`, at its time on the day before: tomorrow's
-- appointments this evening, or the day after's once this evening's time has passed.
INSERT INTO public.job (kind, payload, run_at, idempotency_key)
SELECT 'whatsapp.day_before_reminders', jsonb_build_object('date', (eve + 1)::text),
  (eve + at_time) AT TIME ZONE 'Asia/Kolkata', 'whatsapp.day_before_reminders:' || (eve + 1)::text
FROM (
  SELECT at_time, CASE
    WHEN (now() AT TIME ZONE 'Asia/Kolkata')::time < at_time
      THEN (now() AT TIME ZONE 'Asia/Kolkata')::date
    ELSE (now() AT TIME ZONE 'Asia/Kolkata')::date + 1
  END AS eve
  FROM (SELECT coalesce((SELECT (s.value #>> '{}')::time FROM public.setting s
    WHERE s.key = 'reminders.day_before_time'), time '18:00') AS at_time) setting
) tonight
ON CONFLICT (idempotency_key) DO NOTHING;--> statement-breakpoint

-- The morning run for today's appointments, or tomorrow's once this morning's time has passed.
INSERT INTO public.job (kind, payload, run_at, idempotency_key)
SELECT 'whatsapp.morning_reminders', jsonb_build_object('date', day::text),
  (day + at_time) AT TIME ZONE 'Asia/Kolkata', 'whatsapp.morning_reminders:' || day::text
FROM (
  SELECT at_time, CASE
    WHEN (now() AT TIME ZONE 'Asia/Kolkata')::time < at_time
      THEN (now() AT TIME ZONE 'Asia/Kolkata')::date
    ELSE (now() AT TIME ZONE 'Asia/Kolkata')::date + 1
  END AS day
  FROM (SELECT coalesce((SELECT (s.value #>> '{}')::time FROM public.setting s
    WHERE s.key = 'reminders.morning_time'), time '08:00') AS at_time) setting
) today
ON CONFLICT (idempotency_key) DO NOTHING;--> statement-breakpoint
SELECT set_config('audit.actor', '', false);
