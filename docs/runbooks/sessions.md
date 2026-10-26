# Treatment sessions

## Session check in (SES-01)

Sources: PRD J5.1 ("One tap check in shows 'Session n of N, consent and payment complete'") and M9 (check in gate), and the Frontend Specification ("Gate blocked: 'Consent and payment are needed before the first session.'"). Decisions made by the user on 25 October 2026.

### What a session is

An appointment whose type is in `packages.session_appointment_types` (Session, Zero Gravity Treadmill). The same setting decides package sessions for the reschedule allowance (SCH-10, `docs/runbooks/calendar.md`). Consultations and reviews are not sessions.

### Session n of N

- **N:** the planned sessions of the episode's newest plan (sessions per week × weeks). Without a frequency the label is "Session n" alone. The package meter stays separate (BIL-08).
- **n:** once a session appointment of the episode is checked in, it is 1 + the episode's earlier checked in, in progress or completed session appointments, in order of arrival. No-shows and cancellations never count. Undoing a check in gives the number back, because n is worked out on read.
- SES-03 stores the session row with its number when the session starts.
- **The read:** `internal.session_progress(appointment_ids)` (SECURITY DEFINER, `supabase/migrations/20261025175542_session_progress_rules.sql`) returns the number, the planned total and the episode's status. It answers only for appointments at centres the reader sees, so the front desk gets N without reading the plan. `sessionProgress` in `packages/db/src/sessions.ts` wraps it, and `sessionView` and `sessionGate` in `packages/schemas/src/sessions.ts` give the words.

### The gate

| Episode | Gate | What is shown |
| --- | --- | --- |
| Active, Under review (the chosen plan is paid, BIL-06) | Met | "Session 1 of 12, payment complete", and "Part B consent is not checked yet." |
| Intake pending, Awaiting consultation, Plan proposed | Blocked | "Consent and payment are needed before the first session." |
| On hold, Discharged, Lost to follow up | Blocked | "The episode is On hold." (and so on) |
| No episode | Blocked | "Not part of an episode yet." |

- **Check in:** the front desk can still check the patient in, because they are here.
- **Where the gate shows:**
  - the check-in drawer's Session section
  - Today ("Session n of N" and "Gate blocked" tags)
  - My patients ("Gate blocked: …" in place of Start session)
- **Enforced:** `startVisit` (`apps/web/modules/my-patients/services.ts`) refuses Start session with the gate's message while it is blocked.
- **Consent (DECISION SES-01):** Part B consent (BIL-03) waits for the client's texts. Until then payment alone gates, and BIL-03 adds consent to `sessionGate`.

### Tests

| Test | Covers |
| --- | --- |
| `packages/schemas/src/sessions.test.ts` | the label with and without a frequency; the gate per status; the view |
| `packages/db/src/integration/clinical-record.integration.test.ts` (session check in) | numbered 1, 2, 3 in check-in order, a treadmill visit counted, a review and a consultation not; undo gives the number back; planned from the plan; the physio reads it; the desk at another centre gets nothing; the status before payment |
| `apps/web/modules/my-patients/services.test.ts` | Start session refused for Plan proposed, On hold and no episode; allowed for Under review and for other types |
| `apps/web/e2e/session-check-in.spec.ts` | 360 px and desktop: a paid package episode's session checked in through the drawer, "Session 1 of 12, payment complete"; Today's tags; the physio starts it; an unpaid patient's session held at the gate with no Start session |

**Negative check:** make `sessionGate` always met, and the Start session unit test fails.

## Summary card (SES-02)

Source: PRD J5.2 ("The treating physio sees a summary card from the signed plan; no AI sheet"). Decisions made by the user on 25 October 2026.

### The session screen

- **Where:** `/app/sessions/<appointmentId>` (`apps/web/app/(staff)/app/(signed-in)/sessions/[appointmentId]/page.tsx`). Start session redirects there once the gate is met, and My patients shows Open session on a session in progress. The session note (SES-03) goes under the card.
- **What it is for:** appointments of a session type (`packages.session_appointment_types`). Any other appointment is not found.
- **The heading:** the type, "Session n of N" (SES-01), the patient, OP number, time and centre.

### The card

The summary card of the appointment's own episode, built by `episodeSummary` in `apps/web/modules/patients/record.ts` (shared with the patient record, CLN-12):

1. open red flag alerts and precautions first
2. the episode, then "Phase: not set up yet" (DECISION SES-02; the phase stepper, OUT-04, replaces it)
3. the signed diagnosis, the plan's goals, frequency, review, treating physio, interventions and home programme
4. the last signed note and the next visit

Nothing from the consultant's AI preparation sheet is read. Without an episode it says "Not part of an episode yet."

### Who opens it

| Who | What happens |
| --- | --- |
| The appointment's physio | Opens it |
| The Super Admin | Reads it, marked "Read only: this is <physio>'s session." |
| Another physio | Not found: row level security does not show them the appointment (cover between physios is SES-08) |
| Anyone else who reads the appointment, Velyx support included | Not allowed |

- **Server:** `loadSession` in `apps/web/modules/sessions/services.ts` checks `clinical.read` and the appointment's physio, and logs each open as a record view of the patient.
- **Database:** `sessionVisit` (`packages/db/src/my-patients.ts`) and the card's reads run under the reader's row level security, so nobody outside the centre reads them.

### Tests

| Test | Covers |
| --- | --- |
| `apps/web/modules/sessions/services.test.ts` | the own physio gets the episode's card and the view is logged; another physio, support and the desk are refused; the Super Admin reads it; a consultation is not found; no card outside an episode |
| `apps/web/modules/my-patients/services.test.ts` | Start session returns the session screen; Start consultation still opens the consultation |
| `packages/db/src/integration/clinical-record.integration.test.ts` (session check in) | the physio and the Super Admin read the visit; another physio at the centre and the desk at another centre do not |
| `apps/web/e2e/session-check-in.spec.ts` | 360 px and desktop: Start session lands on the screen with the card and the phase line, Open session opens it again, another physio gets not found and the desk Not allowed |

**Negative check:** drop the own physio check in `loadSession`, and the "another physio" unit test fails; row level security still keeps another physio out in the database test and end to end.

## Session note and Close session (SES-03, SES-07)

Sources: PRD J5.4 (the note's fields) and J5.5 ("Closing a session marks it completed, uses a package session and signs the note"), the Frontend Specification ("Session note", "Pain slider"), the TAD `session` table and Blueprint 11A. Decisions made by the user on 26 October 2026.

### Opening

Start session (`startVisit`, then `openSessionNote` in `apps/web/modules/sessions/services.ts`) opens one `session` row per visit. The database (`internal.session_open`) takes the episode, patient, centre, physio, the number (as SES-01 counts it) and the newest plan from the appointment, never from the caller. The service adds the knowledge base version (rule 4) and the prefilled note:

- the treatment given in the episode's last signed note, or
- for the first session, the plan's interventions and modalities.

### The note

Under the summary card, autosaved (draft kind `session`, `PUT /app/sessions/<appointmentId>/save`):

1. **Any new symptoms?** No or Yes. Yes needs a description.
2. **Since last visit:** what the patient reports.
3. **Pain:** at rest, during activity and after treatment, 0 to 10 (`components/pain-slider.tsx`).
4. **Treatment given:** ticks for the plan's interventions and modalities, and a note.
5. **Response:** Better, Same or Worse, and a note.
6. **Home programme:** the plan's exercises, read only (the plan stays the consultant's), and today's changes.
7. **Next session:** Progress, Maintain, Regress, Reassess or Escalate, and a note.

`sessionNoteSchema` and `sessionNoteBlockers` (`packages/schemas/src/sessions.ts`) define it and what holds Close session back: the new symptoms answer (and description), all three pain readings, a treatment tick, a response and a next session choice.

### Close session

`closeSession` signs the physio's own draft at the version just saved, with the Treats patients tick read at that moment. In the same transaction the database:

- stores the three pain readings in `pain_rest`, `pain_activity` and `pain_after` (the pain line, OUT-03, reads the activity one)
- uses a session of the episode's active package, oldest payment first (`internal.session_sign` calls `internal.use_package_session`) and keeps which in `package_id`; with no active package nothing is used and it still closes
- completes the visit (`internal.session_closed`; `internal.appointment_physio_change` accepts a signed session note)
- for Yes to new symptoms, gives the consultant who signed the episode's consultation a high priority task, "New symptoms reported in session n" (`review.new_symptoms`); without one, the centre's Centre Managers get it

The physio lands on My patients with "Session closed. Its note is signed."

### Who

| Who | Reads | Writes and closes |
| --- | --- | --- |
| The appointment's physio | Yes | Yes, while it is a draft |
| Clinicians who treat patients at the centre | Yes | No |
| Front desk, Finance, other centres | No | No |
| Velyx support | As the role allows | Never (restrictive policies) |

A signed note never changes (`internal.session_guard`), not even who signed it or when. Signed notes on the patient record and their addenda come next.

### Tests

| Test | Covers |
| --- | --- |
| `packages/schemas/src/sessions.test.ts` | the note's defaults, the blockers in order, the prefill |
| `apps/web/modules/sessions/services.test.ts` | opening prefilled from the last note or the plan; the screen's note for its physio and read only for the Super Admin; save and close refusals (someone else's, signed, stale, without the tick, blocked) |
| `packages/db/src/integration/clinical-record.integration.test.ts` (session check in) | one row per visit numbered from the appointment; only the note changes; a colleague reads but cannot write; the desk, another centre and support cannot; closing completes the visit and uses one package session; no package still closes; Yes gives the consultant one task; a signed note never changes |
| `apps/web/e2e/session-check-in.spec.ts` | 360 px and desktop: prefilled ticks, Close held back with what is missing, the note filled and kept across a reload, Close session to My patients, the visit Completed, one package session used, the signed note read only, the consultant's task |

**Negative check:** let a signed session change in `internal.session_guard`, and the database test fails on "nor who signed it or when".
