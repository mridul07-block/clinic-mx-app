# My patients today

The physio's home at `/app/my-patients` (CLN-01; Frontend Specification "Physiotherapist": "My
patients today (home): Patients in time order with status, form status, alerts, 'Preparation sheet
ready' (Consultant tick). Primary action: Start consultation / Start session").

Decisions (user, 24 October 2026):

- **Start** marks a checked in visit In progress, so the front desk's Today shows it with the
  physio. Only the appointment's own physio starts it, on its day; the database enforces both.
- **Live:** the list updates by itself, like Today and the calendar (`live.refresh_seconds`).

## Who and what

- **For** everyone with the Treats patients tick (`visits.start`). Physiotherapists land on it
  after signing in (`homePath`); others with the tick have "My patients today" on Home. Velyx
  support never has it.
- **Lists** the person's own appointments today (IST) at every centre, by start, leaving out
  Cancelled and Rescheduled (`myPatientsToday`, `packages/db/src/my-patients.ts`).
- **Each visit shows:**
  - time, patient (opens their record), type, and the centre when the person works at more than
    one;
  - status: Booked, Confirmed, Running late (`day.running_late_minutes`), "Here n min", "With you
    since 10:05", Completed or No show;
  - form status, for a first visit for a problem only (a visit in an open episode has no form):
    Not sent, Waiting for the patient, Submitted, Link expired or Consent declined;
  - open red flag alerts on the visit's episode, in the tone of the loudest, opening Alerts;
  - "Start consultation" (Consultation type) or "Start session" (any other type) once the patient
    is checked in.
- **"Preparation sheet ready"** (Consultant tick) joins each visit when AI-03 stores preparation
  sheets; until the AI tickets, nothing is shown (the job is a placeholder, AI-09).

## Start

`startVisit` (`apps/web/modules/my-patients/services.ts`): the appointment's own physio, Checked in,
on its IST day; it becomes In progress with `started_at` and `started_by`, audited as them. Messages:
"Check the patient in first.", "This visit has started already.", "Only the physio of this
appointment can start it.", "A visit is started on its own day.". There is no undo. Start
consultation also opens the consultation and goes to it (CLN-02, `docs/runbooks/consultation.md`):
it needs the Consultant tick and the submitted health form ("The health form is needed before the
consultation. The front desk can open it on the tablet."); the started row then shows "Open
consultation". SES-03 (the session note) opens from Start session.

Enforced twice. The database (migration `my_patients_today_rules`):

| Rule | Where |
| --- | --- |
| In progress only from Checked in, on its IST day, with `started_by` = the appointment's physio; from In progress only on to Completed | `appointment_status_guard` |
| A physio updates only their own appointments (`physio_id` = them, Treats tick) | Policy `appointment_start` |
| Someone who does not edit patients may change only Checked in to In progress (status, `started_at`, `started_by`, `updated_at`) | Trigger `appointment_physio_change` (42501) |
| In progress always has `started_at` and `started_by` | Check `appointment_started` |
| A physio reads the health form links and consents of their own appointments | Policies `patient_link_physio_read`, `consent_record_physio_read` |

Start session waits for the session's gate, and a session row shows "Session n of N" (SES-01,
`docs/runbooks/sessions.md`).

## Live

The page polls `/app/my-patients/live?since=<version>` every `live.refresh_seconds` with the live
header (never counted as activity); only a changed list comes back.

## Checking it

| Test | What it checks |
| --- | --- |
| `packages/db/src/integration/my-patients.integration.test.ts` | Under row level security as a physio: own visits in order, without cancelled or another physio's; form submitted, consent declined, one open alert (a closed one left out). Start as them, stamped and audited. Refused: the desk starting it, before check in, another day, any other change, another physio (reaches nothing), going back from In progress. |
| `apps/web/modules/my-patients/services.test.ts` | The tick; own visit, checked in, not started, today; support reads only. |
| `packages/schemas/src/my-patients.test.ts` | Start labels, form status, loudest alert. |
| `apps/web/e2e/my-patients.spec.ts` | 360 px and desktop. A temporary physio lands on the list: Running late with Form Not sent, Here with Form Submitted and 1 open alert, Booked, in time order; Start consultation opens the consultation, and back on the list shows "With you since" and Open consultation; a check in shows without a reload; the desk's Today shows In progress; the desk cannot open the page. A physio with nobody booked is told so. |

Negative check: without the `appointment_physio_change` trigger, the "any other change" database
test failed (CLN-01).
