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

| Who | Reads a draft | Reads a signed note | Writes and closes |
| --- | --- | --- | --- |
| The appointment's physio | Yes | Yes | Yes, while it is a draft |
| Clinicians who treat patients at the centre | Yes | Yes | No |
| Clinicians at other centres, and the Super Admin (with or without the tick) | No | Yes: a signed note is part of the record (CLN-12, `20261026054611_session_signed_read.sql`) | No |
| Front desk, Finance, Centre Managers without the tick | No | No | No |
| Velyx support | No | No | Never (restrictive policies) |

A signed note never changes (`internal.session_guard`), not even who signed it or when. Changes are
addenda (CLN-12 follow up, user decisions 26 October 2026):

- **Where:** under the signed note on the session screen, and on the patient record's Notes, where
  the note is listed with the consultations and opens read only in place.
- **Who adds:** as on a consultation, the Treats patients tick now, at the episode's centre or on
  one's own note; never Velyx support. `addSessionAddendum`
  (`apps/web/modules/sessions/services.ts`); in the database `internal.adds_session_addendum`.
- **Who reads:** whoever reads the note (`internal.reads_session`).
- **What they do:** a session addendum queues no document; `internal.addendum_summary_job` skips
  it.

### Tests

| Test | Covers |
| --- | --- |
| `packages/schemas/src/sessions.test.ts` | the note's defaults, the blockers in order, the prefill |
| `apps/web/modules/sessions/services.test.ts` | opening prefilled from the last note or the plan; the screen's note for its physio and read only for the Super Admin; save and close refusals (someone else's, signed, stale, without the tick, blocked) |
| `packages/db/src/integration/clinical-record.integration.test.ts` (session check in) | one row per visit numbered from the appointment; only the note changes; a colleague reads but cannot write; the desk, another centre and support cannot; once signed, the Super Admin without the tick and another centre's physio read it, support and the desk do not; closing completes the visit and uses one package session; no package still closes; Yes gives the consultant one task; a signed note never changes |
| `packages/db/src/integration/clinical-record.integration.test.ts` (takes addenda once signed) | none on a draft; its physio and a colleague at the centre add, another centre, the Super Admin without the tick, the desk, support and another episode do not; read at any centre, not by the desk or support; on the record with names at another centre; no job queued; exactly one target |
| `apps/web/e2e/session-check-in.spec.ts` | 360 px and desktop: prefilled ticks, Close held back with what is missing, the note filled and kept across a reload, Close session to My patients, the visit Completed, one package session used, the signed note read only, the consultant's task; an addendum on the session screen; a colleague reads the note on the record's Notes with its digest, adds an addendum, and the card's last note is the session |

**Negative check:** let a signed session change in `internal.session_guard`, and the database test fails on "nor who signed it or when". Drop `status = 'signed'` from `internal.adds_session_addendum`, and the addenda test fails on "a draft has none".

## Same as last time (SES-04)

Done when "Same as last time" copies the previous note for editing (PRD M9, Frontend
Specification "Session note"). Decisions (user, 26 October 2026):

- **What it copies:** from the episode's previous signed session note, the plan side of the note:
  treatment (ticks and note), home programme changes, and next session (choice and note). "Any
  new symptoms?", since last visit, the three pain readings and the response are today's to ask
  and measure, so they stay as they are.
- **When it asks:** before replacing what the physio entered. If the copied sections differ both
  from how the draft opened (prefilled from that note, SES-03) and from the note itself, an inline
  "Replace what you have entered with last time's note?" offers Replace and Keep mine. Otherwise
  it copies at once. The copy autosaves, stays editable, and says "Copied from session n. Check
  it before closing."
- **When it shows:** only on the physio's own draft, and only when the episode has a signed note
  before. It reads "Same as last time (session n, date)".

| Piece | Where |
| --- | --- |
| The copy and when to ask | `sameAsLastTime`, `sameAsLastTimeOverwrites`, `packages/schemas/src/sessions.ts` |
| The previous note (number, date, note) | `lastSignedSessionNote`, `packages/db/src/sessions.ts`, read under row level security as the physio |
| Given to the screen | `SessionNoteView.lastTime` in `loadSession`, `apps/web/modules/sessions/services.ts` (null unless the note is editable) |
| The button and the confirm | `sessions/[appointmentId]/session-note.tsx` |

### Tests

| Test | Covers |
| --- | --- |
| `packages/schemas/src/sessions.test.ts` (Same as last time) | the three sections copied and nothing of today; no question on an untouched or already copied draft; a question once a copied field was edited |
| `apps/web/modules/sessions/services.test.ts` | `lastTime` for the physio's own draft with its number and date; none for the Super Admin, a signed note or without an earlier note |
| `packages/db/src/integration/clinical-record.integration.test.ts` (closes by signing) | the newest signed note read with its number and date |
| `apps/web/e2e/session-check-in.spec.ts` | 360 px and desktop: no button on session 1; on session 2, a typed treatment note asks first, Keep mine keeps it, Replace copies, today's questions stay open, and a reload keeps the copy |

**Negative check:** let `sameAsLastTime` copy the pain readings too, and the schema test fails.

## Adverse events (SES-06)

Done when an adverse event requires a description and alerts the consultant (PRD M9; PRD J7.2
and Consultation SOP 15.2: adverse events go to the Clinical Director within 24 hours; the
Blueprint records them under the response). Decisions (user, 26 October 2026):

- **Recording:** an optional "Adverse event" tick under Response in the session note. Ticked, it
  needs "Describe the adverse event" before Close session ("Describe the adverse event." in
  Before closing). It records the description only. When nothing happened, nothing extra is
  needed.
- **Who is alerted, and when:** at Close session, from the signed note, two high priority tasks:
  - "Adverse event in session n" for the consultant who signed the episode's consultation (the
    Centre Manager role at the centre when there is none)
  - "Adverse event in session n: Clinical Director review" for the Super Admin role, which stands
    in for the Clinical Director (DECISION SES-06)
- **Where it shows:** a signed note shows the tick and description read only. On the record's
  Notes, the digest ends "Adverse event" and the note shows its description. "Same as last time"
  never copies it.

| Piece | Where |
| --- | --- |
| The tick, the description, the blocker | `sessionNoteSchema.response.adverseEvent`, `sessionNoteBlockers`, `packages/schemas/src/sessions.ts` |
| The stored description | `session.adverse_event` (check `session_adverse_event`), taken from the note by `internal.session_sign` on signing; nobody sets it (it is not among `session_guard`'s signing columns); ticked and blank is refused (23514) |
| The two tasks | `internal.session_closed` (`20261026083950_session_adverse_event_rules.sql`), kinds `review.adverse_event` and `review.adverse_event_director` |
| The form | `sessions/[appointmentId]/session-note.tsx`; read only on the record in `components/signed-session-note.tsx` |

### Tests

| Test | Covers |
| --- | --- |
| `packages/schemas/src/sessions.test.ts` (an adverse event, sessionNoteDigest) | none on an older note; the blocker until described; the 2000 character limit; never copied; the digest names it |
| `packages/db/src/integration/clinical-record.integration.test.ts` (adverse event) | nobody sets the column; ticked and blank refused; signed with one: the description stored, one consultant task and one Super Admin role task; without the tick: nothing stored and no task |
| `apps/web/e2e/session-check-in.spec.ts` | 360 px and desktop: session 2 ticked, held back until described, closed; the physio (the consultant here) has the task; a Super Admin has the Clinical Director task and reads it on the record's Notes |

**Negative check:** take the adverse event branch out of `internal.session_closed`, and the database test fails.
