# Demo data

Staging starts empty: the seed makes only the three centres and the test staff logins. Run
`pnpm demo:fill` to fill staging, or the local stack, with made up patients, so every screen has
something on it for testing.

Every patient is generated. Each has a realistic made up name, a `+91 99` number with random digits,
and an email on `@demo.clinicmx.test`. That email domain is the marker that tells demo rows apart.
No real person's data is used (rule 12).

## Commands

| Command | Does |
| --- | --- |
| `pnpm demo:fill` | Fills the local stack (`127.0.0.1`). |
| `pnpm demo:fill --target staging` | Fills staging, from main, with the settings in `apps/web/.env.local`. |
| `pnpm demo:remove` / `pnpm demo:remove --target staging` | Takes every demo patient away again. |
| `bash scripts/demo-e2e.sh` | Fills the local stack, checks the screens at 360 px and desktop with screenshots, and removes the demo data after. |

Both commands print counts only, never an address, a secret or a name.

**Keeping it fresh:** Today, the Calendar and My patients show today's visits, so run
`pnpm demo:fill` again on the day you test. Each run:
- adds today's visits at each centre;
- books the next session for patients still in treatment;
- leaves the history as it is.

A second run on the same day changes nothing.

## What it makes

**About 60 patients, 20 per centre.** Each patient's history runs from booking to where they are
now:
- health form and Part A consent;
- a consultation signed with a real condition from the knowledge base, with its plan of care;
- the plan choice: a package, pay per session, or "I'll think about it";
- bills and payments;
- treatment sessions twice a week, with pain readings going down;
- the odd no show or cancellation.

**The episodes cover every stage:**
- awaiting consultation;
- plan proposed;
- think about it;
- active;
- under review (with a "6 week review overdue" task);
- on hold (a referred red flag);
- discharged, with feedback scores.

About half the discharges are 3 to 6 months back, so the revenue chart has a trend.

**Today at each centre:**
- a consultation done this morning (signed, fee still to pay);
- one with the physio now (note a draft);
- one here now (checked in, health form in, physio notified);
- a walk in;
- one coming later, confirmed;
- one not confirmed, whose contact consent was declined;
- a no show (with its call back task);
- a treatment session done this morning.

Close to midnight, the visits that can't fit on today are skipped, never failed.

**Also:**
- WhatsApp messages delivered and read;
- a few that failed in the last week, for the Not delivered list;
- open red flag alerts.

**The set up the screens need**, each part made only if nothing like it exists yet:
- hours for the test physios, Monday to Saturday 9:00 to 13:00 and 16:00 to 20:00;
- consultation fees;
- 6 and 12 session packages;
- two discounts;
- eight library exercises;
- a kiosk tablet per centre;
- leave next week, one day approved and one afternoon requested.

**Left out:**
- **Questionnaire results:** no instrument has a definition or sign off yet (SET-08).
- **AI preparation sheets:** they need the AI key on staging, and AI run records can never be
  deleted.

**Made later by the job runner (staging):** the signings queue the clinic's own jobs, which run
within minutes:
- the consultation summary, discharge report and referral letter PDFs, for the Documents tab;
- the 6 week Review bookings;
- the "think about it" follow ups and service recovery escalations.

Locally, nothing runs the jobs, so these stay queued.

## How it works

The code lives in `packages/db/src/demo`.

- **Through the database's rules:**
  - Each patient is written in one transaction, as the system actor `system:demo`, through the
    same functions the app uses: `signConsultation`, `openSession`, `signSession`, `checkIn`,
    `startVisit`, `markNoShow`, `confirmAppointment`.
  - The steps that check who acts run under that person's claims: the consultant signs and
    discharges, the physio signs sessions.
  - Bills come from the database's own triggers: the consultation fee, packages and per session
    bills.
  - Payments and packages are written straight in, so no receipt or invoice job is queued.
- **Before anything:** the fill and the remove check the login may turn triggers off for a
  transaction (`session_replication_role`), and refuse at once if not.
- **Back-dating:** some times are always set to now (a signing, a milestone, a plan choice). Once
  a patient's records are written, those times are moved back to when the history says. Triggers
  are off for just those updates (`session_replication_role = replica`, `BackDates` in
  `helpers.ts`), and the audit log keeps the records' creation.
- **Today's visits:** these go through check in, start and no show on their own day, so the
  database's day rules apply.
- **No overbooking:** each visit takes the first free time for its physio.
- **Stopping part way:** a run that stops keeps what it made. The next run carries on, because
  every patient is found by their marker email.

## WhatsApp safety

- The fill refuses unless `whatsapp.test_recipients_only` is on, and refuses if a demo number is
  on `whatsapp.test_recipients`.
- Messages are written with their final status (delivered, read, failed), so none is ever queued
  to send.
- Every WhatsApp job a fill transaction queues is deleted before it commits: booking
  confirmations, consultation summaries, safety advice, no show messages. Each fill transaction
  writes demo rows only.
- Reminders the job runner makes later for future demo bookings meet the test recipients setting
  and show as Not sent.

## Removing it

`pnpm demo:remove` (`remove.ts`) works in four steps:
1. It starts from the demo patients and follows the database's own foreign keys to every row that
   points at them, round by round. It also finds tasks and queued jobs whose details name any of
   them.
2. It deletes the lot in one transaction, with triggers off, because signed notes refuse to be
   deleted on purpose. Before it commits, it checks every foreign key into the tables it touched,
   composite ones included, and stops if any row would be left pointing at a removed one.
3. It writes one audit entry for the removal (`demo_data`, with its counts); the audit log keeps
   every earlier event about the rows.
4. It deletes the removed documents' PDFs from the `documents` bucket, through the service role
   key (`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`, in `.env.local` for staging).
Rows that must stay but point at a demo row, such as a kiosk tablet showing a demo link, have the
link cleared instead.

The set up stays: hours, fees, packages, discounts, exercises, tablets and leave. Exercises can
never be deleted. Remove the rest through the app if you want staging bare.

Run it before the clinic's staff train on staging, if they should start from a clean list.

## Tests

- **Unit** (`packages/db/src/demo/guard.test.ts`):
  - only the local stack for `local`, and only the staging project (direct or pooled) for
    `staging`;
  - anything else is refused;
  - each slug makes the same made up person.
- **Database** (`packages/db/src/integration/demo.integration.test.ts`, 8 patients a centre so
  every stage is there):
  - Today has visits in each column and My patients has the consultant's visits;
  - consultations are signed weeks back and revenue covers at least 3 months;
  - nothing is queued for WhatsApp;
  - a second fill the same day adds nothing;
  - the remove leaves no demo patient, visit, bill or episode;
  - the set up rows the test made are taken away after.
  - Without the back-dating, the history check fails.
- **End to end** (`apps/web/e2e/demo.spec.ts`, gated, through `scripts/demo-e2e.sh`), at 360 px
  and desktop, with screenshots:
  - the front desk's Today in every column, and the Calendar;
  - the physio's My patients and a patient record with signed notes;
  - the manager's dashboard;
  - finance's collections.
