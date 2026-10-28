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
2. the episode, then its phase ("Phase 1 of 4: Restore & Activate", OUT-04; "Phase: not set up yet"
   before the consultation names a region, "Phase: this workbook has no phased programme" for Bone Stress)
3. the signed diagnosis, the plan's goals, frequency, review, treating physio, interventions and home programme
4. the last signed note and the next visit

Nothing from the consultant's AI preparation sheet is read. Without an episode it says "Not part of an episode yet."

### Who opens it

| Who | What happens |
| --- | --- |
| The note's writer: the appointment's physio, or the colleague who covered it (SES-08) | Opens it |
| The appointment's physio when covered, physios with the Treats patients tick at its centre (SES-08), the Super Admin | Read it, marked "Read only: this is <writer>'s session." |
| A physio at another centre | Not found: row level security does not show them the appointment |
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
| The note's writer: whoever started the visit, its physio or a colleague covering (SES-08) | Yes | Yes | Yes, while it is a draft |
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

## Cover between physios (SES-08)

Done when physios see colleagues' patients in their centres, and notes are signed by the writer.
Decisions (user, 26 October 2026):

- **Colleagues today:** My patients lists the physio's own visits first, unchanged. Below them,
  "Colleagues today" shows, for each centre they work at, the other physios' visits today: time,
  patient, type, "with <physio>", status, session label, and "Covered by <name>" when someone
  covered it. Only staff with the Treats patients tick see it, never Velyx support.
- **Cover:** a colleague's checked in Session or Zero Gravity Treadmill visit, once its gate is
  met, has Start session.
  - Starting it makes the note the covering physio's own: they write it, close it and sign it.
  - The visit stays booked with its own physio. Their list, and the session screen, show "Covered
    by <name>".
  - Consultations are not covered.
- **Once started:** the starter owns the note. Everyone else who opens it reads it.

| Rule | Where |
| --- | --- |
| Physios with the tick read the appointments at the centres they work at | `appointment_read` (`20261026092707_cover_between_physios.sql`) |
| Who may cover: the tick now, working at the visit's centre, a session kind of visit, not their own | `internal.covers_visit`; `coversSessionsAt` (`packages/schemas/src/sessions.ts`) on the server |
| A colleague starts it only as themselves, only once checked in | Policy `appointment_cover_start`; `internal.appointment_status_guard` (`started_by` is the physio, or covers the visit) |
| The note's writer is whoever started it | `internal.session_open` (`physio_id` from `started_by`), policy `session_open`; `session_guard` already signs only as the writer |
| The lists and the screen | `colleaguesToday` (`packages/db/src/my-patients.ts`), `loadColleagues`, `startVisit` (`apps/web/modules/my-patients/services.ts`), `loadSession` (`apps/web/modules/sessions/services.ts`), `my-patients/colleagues-today.tsx` |

### Tests

| Test | Covers |
| --- | --- |
| `apps/web/modules/my-patients/services.test.ts` | a colleague's session started as cover, the note theirs; a colleague's consultation and another centre refused; colleagues listed only at one's centres |
| `apps/web/modules/sessions/services.test.ts` | a colleague at the centre reads; the covering colleague writes and the booked physio reads; a physio elsewhere is refused |
| `packages/db/src/integration/my-patients.integration.test.ts` | colleagues' visits at the centre, none elsewhere; cover only once checked in, never a consultation, only as oneself, still booked with its physio |
| `packages/db/src/integration/clinical-record.integration.test.ts` | a colleague reads the session's visit, a physio elsewhere does not; the covering colleague writes and signs the note, the booked physio cannot, the visit completes |
| `apps/web/e2e/session-check-in.spec.ts` | 360 px and desktop: a colleague reads the session screen read only; session 3 is covered from "Colleagues today", closed and "Signed by" the colleague; the booked physio sees "Covered by" and reads it |

**Negative check:** take the cover clause out of `internal.appointment_status_guard`, and both database cover tests fail.

## Modality parameters (SES-05)

Done when each modality has its parameter fields and a precaution warns when relevant (PRD J5.4;
Blueprint "Treatment dosage" and "equipment use alone does not count as a complete treatment
record"). Decisions (user, 26 October 2026):

- **Fields:** knowledge base data (rule 4) in `plan-catalog.json`, read at the note's own version:
  - every modality has Area treated, Duration (min) and Settings
  - Radial and Focused Shockwave add Energy flux density (mJ/mm²) and Frequency (Hz) (SOP 12.3)
  - all of them are "Awaiting clinical sign-off", and the clinic replaces them with its own lists
    (DECISION SES-05)
- **Before closing:** each ticked modality needs every field filled, and number fields as numbers
  ("Fill the parameters for <modality>.").
- **Precautions:** a ticked modality that warns about one of the episode's signed precautions
  shows "Precaution: <precaution> (<source>)". It needs "Reason it is still given today" before
  closing ("Give a reason for <modality> despite <precaution>."), as the consultation's plan does
  (`modalityWarnings`).
- **Carry over:** the next note's prefill and "Same as last time" bring the parameters; the
  reason is asked again each session.
- **Signed:** the note and the record's Notes show "Parameters": "<modality>: <values with
  units>", and the reason given.

| Piece | Where |
| --- | --- |
| The fields | `plan-catalog.json`, `kb_modality.parameters` (`modalityParameterSchema`) |
| The note's values and reasons | `treatment.parameters`, `treatment.reasons` in `sessionNoteSchema` |
| What blocks closing | `sessionNoteBlockers(note, modalities)`, `packages/schemas/src/sessions.ts`, on the screen and again in `closeSession` |
| The note's modalities with warnings | `sessionModalities` (`packages/db/src/sessions.ts`) and `noteModalities` in `apps/web/modules/sessions/services.ts` |
| The form | the Treatment given section of `session-note.tsx` |

### Tests

| Test | Covers |
| --- | --- |
| `packages/db/src/knowledge/plan-catalog.test.ts` | every modality's fields with sources, shockwave's two more; a repeated or unknown kind of field stops the import |
| `packages/schemas/src/sessions.test.ts` (modality parameters) | blank and non numeric fields block; a warned modality needs a reason; unticked and older notes ask nothing; carried by Same as last time with today's reasons; the line with units |
| `apps/web/modules/sessions/services.test.ts` | the note's modalities with the episode's precautions; Close refused until filled and explained |
| `packages/db/src/integration/clinical-record.integration.test.ts` | the imported modalities' parameters read by a physio, not the desk |
| `apps/web/e2e/session-check-in.spec.ts` | 360 px and desktop: shockwave from the plan warns about pregnancy, blocks until filled (a word in Duration still blocks) and explained; session 2 carries the parameters and asks the reason again; the record shows them |

**Negative check:** let `sessionNoteBlockers` skip the parameters, and the schema test fails.

## Baseline (OUT-01)

Done when consultation measures within 7 days are reused and missing markers are requested at
session 1 (PRD J5.3 and section 7 "Baseline reuse", a setting). Decisions (user, 26 October 2026):

- **What it is:**
  - The region's re-testable markers are always in it: the workbook's "Baseline | Current" rows,
    `kb_measure` of kind `marker` or `grade`. The knee has 7.
  - Any other measure the consultation took within the window (LSI, range of motion, reference) is
    reused too.
  - The region is the consultation's Objective region, or else the health form's
    (`consultationRegion`).
- **The window:** a consultation reading counts when it was taken at most
  `clinical.baseline_reuse_days` (7) days before session 1 started (`session.created_at`). The
  newest consultation's reading of each measure is used. If session 1 is later than that, every
  marker is asked for again.
- **At session 1:**
  - A Baseline section after Pain lists the reused readings, each with "Consultation, <date>".
  - It asks for each missing marker: a number with its unit, or 0 to 3 for a grade.
  - Close session waits until each one has a reading, or is marked "Not tested" with a reason
    ("Record <marker>, or mark it Not tested with a reason.").
- **Frozen:** signing session 1 writes the recorded markers as `measure` rows of the session
  (`session_id`), plus one `baseline_measure` row per measure: reused (`consultation_id`),
  recorded, or not tested (`not_tested_reason`). These never change, so final testing (OUT-07)
  lists exactly these. The signed note shows them.
- **Questionnaires** join the baseline with OUT-02. Other sessions have no Baseline section.

| Piece | Where |
| --- | --- |
| Working it out, blockers, what signing records | `packages/schemas/src/baseline.ts` (`episodeBaseline`, `baselineBlockers`, `baselineRecordings`) |
| The note's entries | `baseline` in `sessionNoteSchema` |
| Reading and writing | `packages/db/src/baseline.ts` (`consultationMeasuresBetween`, `recordBaseline`, `frozenBaseline`) |
| The screen's section, worked out or frozen | `apps/web/modules/sessions/baseline.ts`; `closeSession` checks it again and records it after signing |
| Row level security | `supabase/migrations/20261026141108_baseline_rules.sql`: written only while its physio signs session 1 (`internal.signing_baseline`), a reused reading must be the episode's signed consultation's within the setting's days (`internal.reusable_measure`), a recorded one must be in the session (`internal.session_measured`); read as the session note is (`reads_session`); never updated or deleted; support read only |
| The form | the Baseline section of `session-note.tsx` |

### Tests

| Test | Covers |
| --- | --- |
| `packages/schemas/src/baseline.test.ts` | the window's edges (exactly 7 days in, a minute more out, nothing after the start), the newest consultation, other measures reused but never asked for, no region asks nothing, the blockers and grades, the recordings, the reading text, older notes |
| `apps/web/modules/sessions/services.test.ts` | the window from the session's start; Close refused until each marker is recorded or explained, then the baseline written after signing; session 3 records none; the frozen view in the workbook's order |
| `packages/db/src/integration/clinical-record.integration.test.ts` (the baseline) | written while its physio signs session 1 only (not a draft, a colleague, support or session 2); a reading the consultation never took, or a recorded one with no reading, refused; read wherever the note is; never changed; a reading a minute outside the setting's days refused, exactly the days allowed |
| `apps/web/e2e/baseline.spec.ts` | 360 px and desktop: knee pain and quadriceps from 3 days ago reused, 6 markers asked for, a grade, readings and one Not tested; closed and frozen, 8 rows |

**Negative check:** drop the date condition from `internal.reusable_measure`, and the database
test fails ("too old").

## Session 4 reassessment (OUT-05)

Done when the treating physio records the markers at session 4 and the consultant reviews and signs
the decision (PRD J5.10; section 7 "Reassessment", `clinical.reassessment_session` = 4). Decisions
(user, 26 October 2026; DECISION 7 default until the client decides who performs it):

- **Who:** whoever writes the reassessment session's note measures (the booked physio, or the
  colleague covering it). The episode's consultant, who signed the consultation, reviews and
  signs.
- **What:**
  - exactly the measures of the frozen baseline (OUT-01), in the workbook's order
  - each shows its baseline reading
  - a side by side measure takes both sides, with the LSI or deficit change shown as it is typed
  - a grade is 0 to 3 in one tap
  - one not tested at baseline is asked for again
  - an episode without a baseline asks nothing
- **Gate:** Close session waits until each one is recorded, or marked Not tested with a reason
  ("Record both sides of Quadriceps, or mark it Not tested with a reason.").
- **Signing the session writes:**
  - the readings, as `measure` rows of the session
  - one `reassessment` row, with the reasons not tested
- **The database then:**
  - stamps the consultant (`internal.reassessment_guard`), so nobody names someone else
  - gives the consultant a task, "Review the session 4 reassessment"
- **Review (`/app/reassessments/<id>`, from the task's "Open the reassessment"):**
  - the baseline and the session's reading for each measure, with the change ("LSI 80% →
    92%", "6/10 → 3/10")
  - The consultant writes the decision in their own words and signs it ("Sign decision"):
    - once, with the Treats patients tick now
    - It never changes, not even by the database owner, and is never deleted.
    - Signing closes their task with the same decision.
  - Others who read the session note read it; the signed session note shows it and who reviewed
    it.

| Piece | Where |
| --- | --- |
| Blockers, readings, change text, the decision | `packages/schemas/src/reassessment.ts`; `reassessment` in `sessionNoteSchema` |
| Writing, reading, signing | `packages/db/src/reassessment.ts` (`recordReassessment`, `reassessmentById`, `signReassessment`, `frozenBaselineOfEpisode`) |
| The session's section, baseline against now | `apps/web/modules/sessions/reassessment.ts`; `closeSession` checks and records it after signing |
| The review and signing | `apps/web/modules/reassessments/services.ts` (`consultant_records.sign`), `reassessments/[reassessmentId]/page.tsx` |
| Rules | `supabase/migrations/20261026161651_reassessment_rules.sql`: a session's readings only while its physio signs session 1 or the reassessment session (`internal.signing_session_numbered`); the row only then; the consultant stamped; signed once by them; the task opened and closed; read as the session note; support read only |

### Tests

| Test | Covers |
| --- | --- |
| `packages/schemas/src/reassessment.test.ts` | both sides, a value, grades, Not tested with a reason; the recordings; the change text; older notes; the decision's bounds |
| `apps/web/modules/sessions/services.test.ts` (reassessment) | session 4 asks the baseline's measures in order, session 3 nothing; Close refused, then the reassessment written after signing; no baseline asks nothing; the signed view with the change and the review |
| `apps/web/modules/reassessments/services.test.ts` | only the episode's consultant signs, while unsigned, with the tick; the view logged; others refused |
| `packages/db/src/integration/clinical-record.integration.test.ts` (reassessment) | written only while its physio signs session 4 (not a draft, a colleague, support, session 3); consultant stamped and tasked; read at the centre, not by the desk or support; signed by the consultant alone, once, closing the task; never changed or deleted; readings refused at session 2 |
| `apps/web/e2e/reassessment.spec.ts` | 360 px and desktop: session 4 retakes quadriceps, pain and effusion with live change; the consultant opens the task, sees the change and signs; the task closes; the note shows the review |

**Negative check:** let `internal.signing_session_numbered` accept any session number, and the
database test fails ("not session 3", "session 2").

## Final testing (OUT-07)

Done when exactly the baseline markers are listed with before and after (PRD J6.2). Decisions
(user, 27 October 2026):

- **Where:** the episode's Review and discharge screen (`/app/episodes/<id>/review`, Frontend
  Specification "Review and discharge (Consultant tick)"). It opens from:
  - Start review on a Review visit in My patients (Open review once it is In progress)
  - "Review and discharge" on the patient's summary card, once the episode is Active, Under review
    or Discharged

  OUT-08 and OUT-10 add readiness and discharge to the same screen.
- **Who:** anyone with the Consultant tick and the Treats patients tick now; not only the episode's
  consultant.
- **When:** while the episode is Active or Under review (`takesFinalTest`).
- **What:**
  - exactly the measures of the frozen baseline (OUT-01), at the baseline's knowledge base version
  - each shows its baseline reading and, when session 4 reassessed it (OUT-05), that reading
  - the same inputs as session 4 (`components/retest-inputs.tsx`): both sides of a side by side
    measure, a grade in one tap, the change from baseline shown as it is typed
  - an episode without a baseline shows nothing to retest
- **Gate:** "Sign final testing" waits until each measure is recorded, or marked Not tested with a
  reason; what is missing is listed above the button.
- **Signing:** once per episode. Recording is signing: there is no draft.
  - The database stamps who signed and when (`internal.final_test_guard`).
  - The readings are `measure` rows of the `final_test`.
  - It never changes, not even by the database owner, and is never deleted.
- **After:** the screen lists each measure as Baseline, Session 4, Final and the change from
  baseline to final ("LSI 80% → 95%", "6/10 → 1/10"), signed by whom and when. Clinical readers
  read it at any centre (it is always signed).

| Piece | Where |
| --- | --- |
| Input and status rule | `packages/schemas/src/final-testing.ts` (`finalTestSchema`, `takesFinalTest`); blockers, recordings and change text from `reassessment.ts` |
| Writing and reading | `packages/db/src/final-testing.ts` (`recordFinalTest`, `finalTestOfEpisode`, `finalTestReadings`, `reassessmentOfEpisode`, `baselineVersionOfEpisode`) |
| The screen and signing | `apps/web/modules/reviews/services.ts` (`loadReview`, `signFinalTest`, `consultant_records.sign`), `episodes/[episodeId]/review/` |
| Start review | `apps/web/modules/my-patients/services.ts` (`reviewEpisodeId`), `startLabel` |
| Rules | `supabase/migrations/20261026183216_final_test_rules.sql`: both ticks now, a treated episode with a baseline, its version, not tested only for baseline measures (`internal.final_test_guard`); readings only with the signer's own final test of this transaction, baseline measures only (`internal.writing_final_test`, `internal.in_baseline`); read by clinical readers; never updated or deleted; support read only; audited |

### Tests

| Test | Covers |
| --- | --- |
| `packages/schemas/src/final-testing.test.ts` | entries by measure key; Active and Under review only |
| `apps/web/modules/reviews/services.test.ts` | baseline with session 4; who signs; not treated or no baseline signs nothing; the signed rows with the change; recorded or not tested; refusals (a physio, no tick, a gap, discharged, no baseline, twice, support) |
| `apps/web/modules/my-patients/services.test.ts` | Start review opens the Review and discharge screen |
| `packages/db/src/integration/clinical-record.integration.test.ts` (final testing) | signed by a consultant with both ticks, not a physio or support; baseline measures only; once; stamped and audited; read at any centre, not by the desk or support; never changed or deleted; readings only with one's own final test in its transaction; refused while Plan proposed or without a baseline |
| `apps/web/e2e/final-testing.spec.ts` | 360 px and desktop: Start review opens the screen; three baseline measures with session 4; signing waits; live change; signed rows with before and after; Open review and the summary link |

**Negative check:** drop the baseline key check from the `measure_final_test` policy, and the
database test fails ("a reading outside the baseline").

## Readiness and clearances (OUT-08)

Done when each criterion is Met, Not met or Not assessed, clearance is disabled while anything is Not
assessed, the three statuses are signed, and an override takes a reason (PRD J6.3 to J6.5; section 7
"Return to sport"). Decisions (user, 27 October 2026):

- **Criteria:** the region workbook's readiness section, imported as versioned knowledge
  (`kb_readiness_criterion`, `docs/runbooks/knowledge-base.md`), one criterion per line:
  - each measure a count line names, judged by its own rule (an LSI passes; a deficit is
    symmetrical, full or mild; a reference target is reached), or by the row's target or MCID
    column (lumbar)
  - each yes or no line, which the consultant marks Met, Not met or Not assessed
  - a count of positive screen items ("Red flags positive"), Met when none is positive
  - the yes or no rows only the overall verdict names (Bone Stress entry gates, Lumbar safety
    netting), after the section's
- **Which version and region:** the region the signed consultation measured (as the baseline works it
  out); the newest live knowledge base version (SET-06) holding criteria for it. A clearance stores both.
- **Readings:** a measured criterion uses the newest reading in the episode (consultation, session,
  session 4, final testing or the panel), and an MCID the first. One never measured shows "Not
  measured in this episode."; the consultant records a reading on the panel ("Record a reading"),
  stored as `measure` rows of a `readiness_recording`.
- **Override:** for a criterion Not met or Not assessed, a written reason ("Override", "Save
  override"); the latest reason counts and shows on the panel (and the report, OUT-11).
- **Clearances:** Rehabilitation complete, then Return to training, then Return to sport, each signed
  once. Each is blocked while any criterion is Not met or Not assessed without an override, in the
  Frontend Specification's words ("2 tests not assessed. Record them or add an override reason.").
  The same criteria gate all three (DECISION OUT-08). A clearance keeps every criterion as it stood:
  result, reading and override.
- **Who:** marking, recording, overriding and signing need the Consultant and Treats patients ticks
  now, on an Active or Under review episode. Clinical readers read it all at any centre.

| Piece | Where |
| --- | --- |
| Reading the workbooks | `packages/db/src/knowledge/readiness.ts`, called by `buildObjective`; the report's "Readiness criteria" |
| Verdicts, blockers, order, inputs | `packages/schemas/src/readiness.ts` (`measuredResult`, `clearanceBlockers`, `clearanceRefusal`) |
| Reading and writing | `packages/db/src/readiness.ts` (`latestCriteriaVersion`, `readinessCriteria`, `episodeReadings`, `readinessMarks`, `addReadinessMark`, `recordReadinessReading`, `signClearance`) |
| The panel and its writes | `apps/web/modules/reviews/readiness.ts` (`readinessView`, `markReadinessCheck`, `overrideReadinessCriterion`, `recordReadinessMeasure`, `signReadinessClearance`), `episodes/[episodeId]/review/readiness-panel.tsx` |
| Rules | `supabase/migrations/20261027041531_readiness_rules.sql`: marks and recordings by a consultant with both ticks on a treated episode, for the version's criteria, never changed (`internal.readiness_guard`); panel readings only with one's own recording of this transaction, for a criterion's measure; a clearance in order, once, keeping exactly the region's criteria, each Met or overridden, its checks and override reasons as last marked (`internal.clearance_guard`); support read only; audited |

### Tests

| Test | Covers |
| --- | --- |
| `packages/db/src/knowledge/build.test.ts` (readiness) | knee's nine measures and four lines; lumbar's screen, targets, MCID directions and safety netting; bone stress's verdict rows; unique keys in every region; an unknown line stops the import |
| `packages/schemas/src/readiness.test.ts` | each rule kind, Not assessed without readings; the blocker copy; the order; the override and reading inputs |
| `apps/web/modules/reviews/readiness.test.ts` | the panel's results and sources; blocked until each is Met or overridden; the clearance's kept criteria; refusals; marks, overrides and readings |
| `packages/db/src/integration/clinical-record.integration.test.ts` (readiness and clearances) | the knee criteria; marks, overrides and readings by a consultant with both ticks only; read at any centre, not by the desk or support; never changed; clearances in order, once, refused with a criterion missing, unmet without a reason or a reason not on record; not while Plan proposed |
| `apps/web/e2e/readiness.spec.ts` | 360 px and desktop: thirteen knee criteria; a reading recorded, lines marked, two overrides; the three statuses signed in order |

**Negative check:** drop the "each Met or overridden" check from `internal.clearance_guard`, and the
database test fails ("not assessed without an override").

## Discharge (OUT-10)

Done when the discharge takes a mandatory reason from the list and the lost to follow up job never
marks recovered (PRD J6.6, J5.12 "the episode is never auto closed", decision 19; TAD: signing a
discharge checks the tick at that moment and stores who signed). Decisions (user, 27 October 2026):

- **Who and where:** a consultant with the Treats patients tick, now, on the Review and discharge
  screen, which opens for any episode not yet discharged (the summary card links to it for every
  episode). Final testing and readiness still show only from treatment on.
- **Reason:** one of the Blueprint's seven; Other needs a note. Goals achieved and Independent
  management only after treatment (Active or Under review, or On hold from them); the form greys
  them with the reason why ("Goals achieved needs treatment first: the episode was Plan proposed.
  Non attendance is never counted as recovered."). A Lost to follow up episode is never discharged
  as recovered.
- **Visits ahead:** discharging cancels the episode's Booked or Confirmed visits that start later
  (asked by the clinic, by the consultant); the form lists them first. A visit already started is
  left for the desk.
- **For the report (OUT-11):** the form lists the plan's goals (the latest signed consultation's
  newest plan), each marked Achieved, Partly achieved or Not achieved (all required), and takes
  optional Ongoing needs and Recommendations, and (PAT-03) an optional Return plan and Flare plan.
  They are written with the discharge (`episode.discharge_goals`, `discharge_ongoing_needs`,
  `discharge_recommendations`, `discharge_return_plan`, `discharge_flare_plan`, null unless
  discharged), printed on the discharge report (`docs/runbooks/documents.md`) and shown, as
  written, on the patient's My plan after discharge (`docs/runbooks/my-plan.md`).
- **Stamped:** the database refuses a discharge by anyone else, the system included, and stamps
  `discharged_by` and `closed_at`; the episode heading shows "Goals achieved · discharged by …".
- **Lost to follow up check:** every morning at 6:00 AM IST (`episodes.lost_to_follow_up`) an
  episode Intake pending, Awaiting consultation, Plan proposed, Active or Under review (not On hold)
  nobody has attended for `clinical.lost_to_follow_up_days` (30, a placeholder until the client
  answers decision 19), counted from the last checked in visit or the opening, with nothing booked
  ahead, becomes Lost to follow up: never discharged, never closed. The consultant who signed its
  consultation gets a high task "Lost to follow up: no visit since 27 Sept 2026" (before a signed
  consultation, the centre's Centre Manager). Booking any visit for it again returns the episode to
  where it paused and closes the task ("booked again"); discharging closes it too.

| Piece | Where |
| --- | --- |
| Input, reasons, task, time | `packages/schemas/src/discharge.ts` (`dischargeEpisodeSchema`, `dischargeReasonRefusal`, `watchedForLoss`, `lostToFollowUpTitle`), `nextDailyRun` in `tasks.ts`; the setting in `settings.ts` |
| The check | `packages/db/src/lost-to-follow-up.ts` (`lostEpisodes`, `markLostToFollowUp`, `visitsAhead`), `apps/web/modules/episodes/lost-to-follow-up.ts`, `apps/web/modules/jobs/handlers.ts` |
| The form and its write | `apps/web/modules/reviews/discharge.ts` (`dischargeView`, `dischargeEpisode`), `episodes/[episodeId]/review/discharge-form.tsx` |
| Rules | `supabase/migrations/20261027054917_discharge_rules.sql`: `internal.episode_discharge_guard` (both ticks now, stamps who and when), `internal.episode_discharged_follow_up` (cancels the visits ahead, closes the lost task), `internal.appointment_physio_change` (lets the discharging consultant cancel them), `internal.appointment_returns_lost_episode` (booking again returns it); the setting and the first day's job |

### Tests

| Test | Covers |
| --- | --- |
| `packages/schemas/src/discharge.test.ts` | reason and Other's note; recovered only after treatment, never from Lost; the 6:00 AM run; the task title |
| `apps/web/modules/reviews/discharge.test.ts` | the reasons greyed before treatment, the visits listed; the write; refusals (physio, tick, twice, support) |
| `packages/db/src/integration/discharge.integration.test.ts` | stamped and cancelling the visits ahead; refused to a physio, the desk, the system, a consultant whose tick is off; recovered refused untreated; the check marks only the right episodes, with the consultant's or the manager's task, once; booking again returns it; a discharge closes the task |
| `apps/web/e2e/discharge.spec.ts` | 360 px and desktop: a treated episode discharged as Goals achieved, its visit ahead cancelled; an untreated one with Goals achieved greyed, Other needing a note, Patient choice |

**Negative check:** drop the consultant and Treats patients ticks from
`internal.episode_discharge_guard`, and the database test fails ("refused to a physio without the
Consultant tick").

## Phase stepper (OUT-04, with SET-09)

PRD J5.11 and M10; Frontend Specification "Phase stepper" (Progress tab) and "Stepper (with locked
steps and a reason)". Decisions (user, 27 October 2026):

- **Phases and exit criteria are the workbooks'.** Each region's Phased Programme sheet is imported
  (SET-09): Phase 0 to 4 with name, timing, goal, content and markers, and each phase's Exit
  Criteria split on ";" into lines, word for word. The Bone Stress workbook has none (DECISION
  OUT-04): its episodes say "This workbook has no phased programme."
- **The treating physio marks each line** of the current phase Met or Not yet; nothing is judged
  from readings. The next phase unlocks only when every line's latest mark since the phase was
  entered is Met; then the treating physio moves the patient on one phase.
- **Phase 0 first.** An episode is in Phase 0 until it is moved. Anyone with the Consultant and
  Treats patients ticks moves it to any other phase, either way, with a written reason (1 to 1,000
  characters). Phases passed over that way show as Skipped; a phase entered again starts unmarked.
- **Acceptable exercise pain (DECISION #4)** is the setting `clinical.acceptable_exercise_pain`,
  a placeholder of 5/10 until the client chooses 4/10 (SOP) or 5/10 (workbooks). Beside a line
  naming acceptable pain on loading (six lines, all Phase 1) the stepper shows the newest signed
  session's pain during activity against it; the physio still marks the line.

Who and when:

- Only while the episode is Active or Under review. The treating physio is the newest plan
  version's. The episode keeps the knowledge version and region of its first mark or move; before
  that it follows the newest live version (SET-06) holding phases for the consultation's region.
- Clinical readers read the stepper at any centre (the Progress tab); the desk reads nothing;
  Velyx support never writes. Marks and moves are appended, never changed, and audited.
- The database holds the same rules (`internal.phase_guard`): it stamps who and when, refuses a
  mark by anyone but the treating physio or on a line outside the current phase, a move from a
  phase the episode has left, a skip without an override, an override without both ticks or a
  reason, a phase outside the programme, a second programme, and moving on while a line is not
  Met.
- One episode's marks and moves are serialised: the guard takes a lock on the episode until the
  write commits, and stamps with the clock rather than the transaction's start, so concurrent moves
  cannot both leave the same phase. An episode without a plan has no treating physio, so nobody
  marks or moves on.

| Piece | Where |
| --- | --- |
| Import | `packages/db/src/knowledge/phases.ts` (`readPhases`), `workbook.ts` (`PHASED_SHEET`), the import report's "Phased programmes" |
| Tables | `kb_phase`, `kb_phase_criterion`, `phase_mark`, `phase_move` (`supabase/migrations/20261027150045_phases.sql`, rules `20261027150122_phases_rules.sql`) |
| Rules | `packages/schemas/src/phases.ts` (`phaseStepper`, `progressRefusal`, `phaseLine`, `painLimitHint`) |
| Reads and writes | `packages/db/src/phases.ts`; `apps/web/modules/phases/phases.ts` (`phasesView`, `episodePhaseLine`, `markPhaseCriterion`, `progressPhase`, `overridePhase`) |
| Screen | `patients/[patientId]/phase-stepper.tsx` on the Progress tab; the session summary card's phase line |

### Tests

| Test | Covers |
| --- | --- |
| `packages/schemas/src/phases.test.ts` | Phase 0 first with the unmet lines in words; latest marks; marks only since the phase was entered; skipped and last phases; the override reason; the pain hint |
| `packages/db/src/knowledge/build.test.ts` ("the phased programmes") | 40 phases in eight regions, none for Bone Stress; lines word for word; the six pain lines; a bad header or phase row stops the import |
| `apps/web/modules/phases/phases.test.ts` | who sees the marks and the override; no region or no phases; the treating physio only; moving on only when all are Met; the override's tick, reason, phase and episode status |
| `packages/db/src/integration/phases.integration.test.ts` | the guard and row level security: marks and the move by the treating physio, the episode locked for another connection meanwhile, refusals for an episode without a plan, a line Not yet, another phase, another physio, the desk, an untreated episode, a skip, a stale move, a physio's override, no reason, an unknown phase; never changed; stamped by the database |
| `apps/web/e2e/phases.spec.ts` | 360 px and desktop: Phase 1 locked with Phase 0's lines in words; the treating physio marks three lines and moves on; the pain hint; a consultant overrides to Phase 3 with a reason (Phase 2 Skipped, the history); the session card reads "Phase 3 of 4: Energy Storage & Power" |

**Negative checks:** drop the "every exit criterion is Met" clause from `internal.phase_guard`, and
the database test fails ("a line Not yet"); drop the lock, and it fails ("the episode is locked for
other writers"); compare the treating physio without `coalesce`, and it fails ("no treating
physio").
