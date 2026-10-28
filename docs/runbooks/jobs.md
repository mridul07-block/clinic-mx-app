# Background jobs

FND-10, TAD section 8. Reminders, follow ups, AI preparation sheets and every other piece of time
based work run as jobs.

## How it works

1. Code enqueues a job with `enqueueJob(tx, { kind, payload, runAt, idempotencyKey })` inside the
   transaction of the change that causes it (a booking, a submitted form), so both commit or
   neither does. A second enqueue with the same idempotency key is ignored.
2. Every minute pg_cron runs `internal.jobs_tick()`, which POSTs to `/api/jobs/tick` with
   `Authorization: Bearer <JOBS_SECRET>`.
3. The tick claims due jobs with `FOR UPDATE SKIP LOCKED` (overlapping ticks take different jobs):
   in one transaction it reads at most a batch of due ids, then marks only those still queued as
   running, so a tick never takes more than its batch nor a job another tick holds (25 October
   2026: a single `update … where id in (select … skip locked)` once claimed 20 jobs for a limit of
   10 in the local gate). It runs each with its handler from `apps/web/modules/jobs/handlers.ts`, and marks it done.
4. A failure queues the job again after 1, 2, 4, then 8 minutes. After the 5th failed attempt the
   job is marked failed and a high priority task "Background job … failed 5 times" is created for
   the Super Admin, in the same transaction. A job still running after 10 minutes counts as a
   failed attempt.

Runs are at least once: after a crash a job can run again, so every handler must be safe to repeat
(check before sending, use idempotency keys with providers). Payloads hold ids only, never patient
names or phone numbers; `last_error` keeps only the error's name and message.

## Adding a job

1. Add a handler to `jobHandlers`: a Zod schema for the payload and `run(payload, { db, job })`.
2. Enqueue it where the event happens, with an idempotency key that names the event
   (`reminder.day_before:<appointment id>`).
3. Test the handler, including running it twice.

Kinds so far: `system.ping`; `intake.submitted` (the health form submit pipeline, queued by the
patient's submit; INT-10); `ai.preparation_sheet` (queued by that pipeline; checks the AI gate,
AI-09, `docs/runbooks/ai-gate.md`, then makes the preparation sheet if the submit's own run did
not, AI-03, `docs/runbooks/ai-preparation-sheet.md`); `whatsapp.no_show` (queued by the database when an appointment becomes No show;
ALT-04; does nothing until the WhatsApp tickets); `documents.consultation_summary` (queued by the
database on signing, key `consultation_summary:sign:<consultation id>`, and on each addendum,
`consultation_summary:addendum:<addendum id>`; renders the summary's next version, recording the
key on it so a rerun makes nothing; ALT-06); `whatsapp.consultation_summary` (queued on signing;
does nothing until WA-06); `documents.referral_letter` (queued by the database when a red flag alert
is referred, key `referral_letter:<alert id>`; renders the letter, keyed like the summary; ALT-07);
`whatsapp.red_flag_safety_advice` (queued with each referral, and for Monitor with caution found
in the consultation; does nothing until WA-06; CLN-11); `billing.think_about_it_follow_up`
(queued by the database when "I'll think about it" is recorded, key
`billing.think_about_it_follow_up:<choice id>`, due at the choice's `follow_up_at`; makes the
desk's call task and queues the nudge unless the patient has chosen since; BIL-02);
`whatsapp.think_about_it` (the nudge; does nothing until the WhatsApp tickets);
`documents.invoice` (queued by the database when a payment is recorded, key `invoice:<payment id>`,
and again when it is undone, `invoice:undo:<payment id>`; renders the invoice's next version,
keyed like the summary; BIL-09); `whatsapp.receipt` (queued with each payment; does nothing until
the WhatsApp tickets, whose sender skips a payment since undone);
`whatsapp.package_expiry_reminder` (queued by the database when a package is activated, key
`package_expiry:<package id>`, `packages.expiry_reminder_days` before its last day at
`packages.expiry_reminder_time` IST; does nothing until the WhatsApp tickets, whose sender sends
only while the package is still active; BIL-08); `whatsapp.plan_sessions_list` (queued by the
database once per series booked with Book plan sessions, key
`whatsapp.plan_sessions_list:<plan booking id>`; does nothing until WA-06, whose sender lists the
series' appointments still Booked or Confirmed; SCH-11); `notes.unsigned_flag` (every night at
9:00 PM IST, key `notes.unsigned_flag:<IST date>`; each night first queues the next night in its
own transaction, then flags; a migration queued the first night; CLN-10, see
`docs/runbooks/tasks.md`); `review.book` (queued by the database once when an episode turns Active,
key `review.book:<episode id>`; books the 6 week Review with the consultant, or gives the front
desk a task; books nothing when one is booked already; OUT-06, see `docs/runbooks/calendar.md`);
`episodes.lost_to_follow_up` (every morning at 6:00 AM IST, key
`episodes.lost_to_follow_up:<IST date>`; each day first queues the next day, then marks episodes
nobody attended for `clinical.lost_to_follow_up_days` Lost to follow up with a task, never a
discharge; a migration queued the first day; OUT-10, see `docs/runbooks/sessions.md`);
`episodes.review_overdue` (every morning at 6:00 AM IST, key `episodes.review_overdue:<IST date>`;
each day first queues the next day, then gives the consultant a task for each Active episode past
its 6 week review date with no Review attended or booked ahead and no final test, and closes open
ones no longer due; a migration queued the first day; ALT-02, see `docs/runbooks/tasks.md`);
`feedback.recovery_escalate` (queued by the database with each service recovery task, to run
`feedback.escalate_hours` later, key `feedback.recovery_escalate:<task id>`; a task still open gets
the Clinical Director a task, once; PAT-08, see `docs/runbooks/feedback.md`);
`documents.discharge_report` (queued by the database when an episode with a signed consultation is
discharged, key `discharge_report:<episode id>`; renders the report, keyed like the summary;
OUT-11, see `docs/runbooks/documents.md`); `whatsapp.discharge_report` (queued with it; does nothing
until the WhatsApp tickets, whose sender sends the newest discharge report).

End to end tests run the queue themselves: `apps/web/e2e/jobs.ts` posts to the tick with a test
secret that `playwright.config.ts` gives the server. Tests run in parallel and share the queue, so
another test's tick may be running a test's job when its own tick answers: wait with `tickUntil`
(tick, then check, until the check passes) rather than one `runDueJobs` and an assertion.

## Setting up an environment

Once per environment (staging now, production at the upgrade):

1. Generate a secret of at least 32 random characters. Set it as `JOBS_SECRET` in the Vercel
   project (Production and Preview), with `DATABASE_URL` (the transaction pooler).
2. Store the tick URL and the same secret in Supabase Vault (SQL editor, or the session pooler):

   ```sql
   select vault.create_secret('https://<app host>/api/jobs/tick', 'jobs_tick_url');
   select vault.create_secret('<the secret>', 'jobs_tick_secret');
   ```

   To change one later: `select vault.update_secret(id, '<new value>')` with the id from
   `vault.secrets`.
3. Check it: within a minute `select * from cron.job_run_details order by start_time desc limit 5`
   shows succeeded runs, and `select status_code from net._http_response order by created desc
   limit 5` shows 200. Enqueue `system.ping` and it becomes `done` within a minute:

   ```sql
   insert into job (kind) values ('system.ping') returning id;
   select status, attempts from job where kind = 'system.ping' order by created_at desc limit 1;
   ```

Local and CI databases have no Vault secrets, so their tick does nothing.

## Watching it

- Uptime (FND-12): each tick calls the Better Stack heartbeat `JOBS_TICK_HEARTBEAT_URL` after a
  run; five minutes without a beat alerts the on call phone (`monitoring.md`).
- Waiting work: `select kind, count(*) from job where status = 'queued' group by kind`.
- Failures: open tasks of kind `job.failed`, or `select kind, last_error from job where status = 'failed'`.
- To run a failed job again after fixing the cause:
  `update job set status = 'queued', attempts = 0, run_at = now() where id = '<id>'`, then close
  its task with the decision.
