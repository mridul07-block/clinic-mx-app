# Tasks

The tasks inbox at `/app/tasks` (ALT-03; PRD M11 "every task closed with a decision", J5.9;
Frontend Specification "Tasks": assigned to me, sorted by urgency, close with decision).

Decisions (user, 24 October 2026):

- The inbox lists tasks. Those who read red flag alerts see one line on top, "N open red flag
  alerts", that opens `/app/alerts`; alerts keep their own review, refer and close flow (ALT-01).
- "Take it": one tap takes a role task for yourself; it leaves everyone else's list.

## Who sees a task

Row level security (`task_read`, migration `task_inbox_rules`), the same in the service:

| Task | Seen by |
| --- | --- |
| For one person (`assignee_staff_user_id`) | That person |
| For a role at a centre, nobody has taken it | Everyone with that role who works at the centre |
| For a role with no centre (for example `job.failed` for the Super Admin) | Everyone with that role |
| Any | The Super Admin |

Velyx support reads what its Super Admin role reads and changes nothing (its transactions are read
only). Everyone has `tasks.view` and `tasks.act` (`packages/schemas/src/permissions.ts`); the Home
link shows the open count.

## Order

Most urgent first: priority (urgent, high, normal), then overdue ones, then by due time (none
last), then the oldest (`inboxTasks`, `packages/db/src/tasks.ts`). Due times show in IST. The 20
most recently closed follow, with their decision, who closed them and when.

## Take and close

Staff never create, edit or delete a task. They may only:

- **Take it**: an untaken role task becomes theirs (`assignee_staff_user_id`, `taken_at`).
- **Close with a decision**: required, trimmed, up to 1000 characters ("Write the decision before
  closing."). Closing a role task nobody took takes it in the same step, so every closed task names
  who had it.

Enforced twice: the services (`apps/web/modules/tasks/services.ts`) and the database. Staff have
UPDATE on only `status`, `decision`, `assignee_staff_user_id`, `taken_at`, `closed_by`,
`closed_at` and `updated_at`, and no INSERT or DELETE. The trigger `internal.task_lifecycle`
allows only the two moves, stamps who and when as the signed in person, and refuses any change to a
closed task. The system (no signed in person) may close a task with a decision but never reopen one.
Every change is in the audit trail (`audit_change` on `task`).

## Adding a task kind

Tickets that make tasks (ALT-04 no show calls, BIL-02 "think about it" calls, service recovery,
clinical review) insert them on the server as the system, in the same transaction as the event:

- `kind` (for example `call.no_show`), a plain `title`, `priority`, `due_at` when there is one;
- `assignee_role` with `centre_id` (or `assignee_staff_user_id` for one person);
- `patient_id` and `episode_id` when it is about a patient; `details` holds ids and facts, never
  names or phone numbers;
- add the kind's label to `taskKindLabels` in `packages/schemas/src/tasks.ts`.

Kinds so far:

| Kind | Made by | For |
| --- | --- | --- |
| `job.failed` | A job out of attempts (FND-10) | The Super Admin |
| `call.no_show` | A confirmed no show (ALT-04, `docs/runbooks/no-shows.md`) | The Front Desk at the centre |
| `review.no_shows` | Missed appointments in a row (ALT-04) | The physio of the missed appointment |
| `call.think_about_it` | "I'll think about it" still the patient's choice on day 2 (BIL-02, `docs/runbooks/plan-sheet.md`) | The Front Desk at the episode's centre |
| `review.worsening` | A session note signed "Worse", or with "Escalate" next (ALT-02) | The consultant who signed the consultation (high), else the Centre Manager |
| `review.overdue` | The daily 6:00 AM check: an Active episode past its 6 week review date, no Review attended or booked ahead, no final test (ALT-02); closed by itself once booked or done | The consultant (normal), else the Centre Manager |
| `feedback.service_recovery` | Feedback with any No, or a recommendation score at or below `feedback.recovery_score_max` (PAT-08); its details name the questions answered No and the score, never the patient | The centre's Centre Managers (high) |
| `feedback.service_recovery_director` | A service recovery task still open `feedback.escalate_hours` after the feedback (PAT-08, the queued `feedback.recovery_escalate`) | The Clinical Director: the Super Admin (high), as for adverse events |

## Progress alerts (ALT-02, in part)

PRD M11 and J5.9, Frontend Specification section 9 ("Reassessment overdue"), Blueprint 11C. Built
from what the clinician records and the plan's dates, with no number no document gives;
recommended defaults chosen under the user's standing approval, 28 October 2026 (DECISION ALT-02):

- **Worse or escalated:** a session note signed with the response "Worse", or "Escalate" for the
  next session, is a high task for the consultant who signed the episode's consultation (the
  Centre Manager before one), as SOP 15.2 asks ("unexpected clinical deterioration … same-day
  review"). One per signed note; the note shows "Closing the session gives the consultant a task
  to review the patient today." Raised by `internal.session_closed` in the signing transaction.
- **6 week review overdue:** every morning at 6:00 AM IST (`episodes.review_overdue`) an Active
  episode whose newest plan's review date has passed, with no Review attended, none booked ahead
  and no final test, gets one task (`task_open_review_overdue_key` keeps it to one open); an open
  one whose review is since booked or done is closed with "Closed automatically: the review is
  booked or done."; an episode leaving Active (discharged, on hold, lost to follow up) closes it at
  once, saying so. A Review booked at the desk, which names no episode, counts for the patient's
  episode. A review booked late is not flagged.
- **Waiting for the client:** plateau and no meaningful change (only lumbar has MCIDs, from its
  workbook; the questionnaires come with OUT-02 and SET-08), low adherence (the days ticked on My
  plan exist since PAT-02; what counts as low does not), milestones missed (goals are text; phase times are typical, not deadlines) and repeated
  missed sessions that are not in a row (ALT-04 covers those in a row). Each needs the client's
  rule or threshold.
- **Closing:** with a written decision, as every task. Blueprint 11C's list (continue, modify,
  regress, escalate, seek medical review, discharge) becomes a pick list only if the client says.
- **Manager dashboards:** worse or escalated joins the reviews to do; overdue reviews are counted on
  their own ("6 week reviews overdue").
- **Review (28 October 2026):** an adversarial review found a Review booked at the desk (no
  episode) ignored, tasks closed with the wrong reason or only the next morning, the manager's
  overdue count linking to a list they cannot read (now counted only), and the job missing from
  `docs/runbooks/jobs.md`. All are fixed with tests.

## Knowledge base report (AI-08)

The monthly knowledge base report reaches the Super Admin as a task (`ai.kb_report`, "Knowledge
base report", normal priority), titled "Knowledge base report for Oct 2026", with "Open the
report". One per month, made with the report itself; see `docs/runbooks/ai-kb-report.md`. The
daily AI spend cap's task (`ai.spend_cap`, AI-01) now shows its kind as "AI spend cap reached".

## Unsigned notes flag (CLN-10)

PRD J3.9 ("Unsigned notes are flagged at end of day") and section 7 ("Flagged to the Centre
Manager at end of day", Fixed); TAD job table: 9:00 PM IST daily. Decisions made by the user on
26 October 2026.

- **What counts:** every consultation and session note started and not signed (status draft),
  whatever day it was started, so yesterday's leftovers keep showing until signed.
- **The task:** one per centre with unsigned notes, for the Centre Manager role there
  (`review.unsigned_notes`, "Unsigned notes"), titled "Unsigned notes: 3 at HSR Layout". The card
  lists each note as "Session · <physio> · 26 Oct 2026, 10:00 AM · MVH-00012". There is no patient
  name in the task (rule 12) and no link, since managers do not open clinical notes. Centres with
  none get no task.
- **Next night:** tonight's task replaces last night's open one, which closes as the system with
  "Replaced by tonight's list." (or "Nothing unsigned tonight." when none are left). The manager
  can also close it with a decision as usual. The physio is not told.
- **The job:** `notes.unsigned_flag` `{ date }` at 9:00 PM IST (`UNSIGNED_NOTES_FLAG_TIME`, a named
  constant since the PRD marks it Fixed).
  - Each run first queues the next night in its own transaction (`nextUnsignedNotesRun`: the next
    9 PM after now and after its own night), so a failed night never breaks the chain, and a run
    late after downtime catches up to tonight rather than every missed night.
  - Then it flags (`flagUnsignedNotes`). A centre already flagged for that night is left alone,
    so a repeated run changes nothing.
  - The migration `unsigned_notes_flag` queued the first night.
- **Checking it on an environment:** `select run_at, payload from job where kind =
  'notes.unsigned_flag' and status = 'queued'` shows tonight's run.

| Piece | Where |
| --- | --- |
| The next night, the title, reading the notes | `packages/schemas/src/tasks.ts` |
| The notes and the flag | `packages/db/src/unsigned-notes.ts` |
| The night's run | `apps/web/modules/tasks/unsigned-notes.ts`, handler in `apps/web/modules/jobs/handlers.ts` |
| The card's list | `UnsignedNotes` in `apps/web/app/(staff)/app/(signed-in)/tasks/page.tsx` |

Tests:

- `packages/schemas/src/tasks.test.ts`: the next night (before and after 9 PM, late, early) and
  the title.
- `apps/web/modules/tasks/unsigned-notes.test.ts`: the next night is queued before the flag, and
  stays queued when the flag fails.
- `packages/db/src/integration/unsigned-notes.integration.test.ts`: per centre for the manager,
  signed and other centres' notes left out, no patient; a second run is a no-op; replaced, then
  closed with nothing left; the next night queued once.
- `apps/web/e2e/unsigned-notes.spec.ts`: 360 px and desktop; a consultation and a session draft;
  the job due now; the manager's card lists both without the patient.

**Negative check:** count signed session notes as unsigned, and the database test fails.

## Checking it

| Test | What it checks |
| --- | --- |
| `packages/db/src/integration/tasks.integration.test.ts` | Under row level security: a role's tasks at its centres in urgency order; a taken task leaves everyone else and cannot be taken again or for someone else; closing needs a decision as the person closing, takes the task, is audited and is final (even for the Super Admin); no other column, insert or delete; another centre's desk, a physio and support cannot act; the system can still close one. |
| `packages/db/src/integration/rls.integration.test.ts` | Tasks reach the people they are for and are closed by them. |
| `apps/web/modules/tasks/services.test.ts` | Take and close as the actor; refusals for closed, missing, taken by someone else, another centre and support; the alerts count only for clinicians. |
| `packages/schemas/src/tasks.test.ts` | The decision is required and trimmed; kind labels. |
| `packages/db/src/integration/clinical-record.integration.test.ts` (worse or escalated) | Worse gives the consultant one high task with the rating and plan; Escalate gives one; Better with Progress none (ALT-02). |
| `packages/db/src/integration/review-overdue.integration.test.ts` | One task for the consultant however often the day runs, closed once a Review is booked; none before the date, after a Review attended or On hold; the Centre Manager without a signed consultation (ALT-02). |
| `packages/db/src/integration/manager-dashboards.integration.test.ts` | Worse or escalated in the reviews; overdue reviews counted (ALT-02). |
| `apps/web/e2e/tasks.spec.ts` | 360 px and desktop. A temporary desk opens Tasks from Home and sees generated HSR tasks most urgent first (an overdue one tagged); takes one, and a second desk no longer sees it; Close without a decision is refused; with one the task moves to Recently closed with its decision, audited as the desk. A physio does not see the desk's tasks. |

Negative check: with the `task_lifecycle` trigger dropped, the taking and closing database tests
failed (ALT-03). With "Worse" taken out of `internal.session_closed`, the worse or escalated
database test failed; with an attended Review no longer counted, the overdue test failed (ALT-02,
28 October 2026).
