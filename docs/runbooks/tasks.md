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

## Checking it

| Test | What it checks |
| --- | --- |
| `packages/db/src/integration/tasks.integration.test.ts` | Under row level security: a role's tasks at its centres in urgency order; a taken task leaves everyone else and cannot be taken again or for someone else; closing needs a decision as the person closing, takes the task, is audited and is final (even for the Super Admin); no other column, insert or delete; another centre's desk, a physio and support cannot act; the system can still close one. |
| `packages/db/src/integration/rls.integration.test.ts` | Tasks reach the people they are for and are closed by them. |
| `apps/web/modules/tasks/services.test.ts` | Take and close as the actor; refusals for closed, missing, taken by someone else, another centre and support; the alerts count only for clinicians. |
| `packages/schemas/src/tasks.test.ts` | The decision is required and trimmed; kind labels. |
| `apps/web/e2e/tasks.spec.ts` | 360 px and desktop. A temporary desk opens Tasks from Home and sees generated HSR tasks most urgent first (an overdue one tagged); takes one, and a second desk no longer sees it; Close without a decision is refused; with one the task moves to Recently closed with its decision, audited as the desk. A physio does not see the desk's tasks. |

Negative check: with the `task_lifecycle` trigger dropped, the taking and closing database tests
failed (ALT-03).
