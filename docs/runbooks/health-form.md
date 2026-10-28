# Health form

INT-04, PRD J2.3 and J2.4, Frontend Specification §7, TAD `intake_response`.

The patient fills in the health form at `/p/<token>`, from the QR or on the clinic tablet, with
no login. One topic per screen (`?screen=<key>`, then `?screen=end`). Every screen is saved as it
is sent. A patient who leaves gets **Continue** and carries on where they stopped, on any device
with the link, until the link ends.

## Decisions (user, 23 October 2026)

- **Version 1 (`hf-1`)** has the two screens whose wording already exists. Both are marked
  `awaitingApproval` until the client approves patient wording (INT-05).
  1. **Your problem:** "Body region", one choice from the Blueprint's regions.
  2. **Warning signs:** the screening questions in `packages/schemas/src/red-flags.ts`, in the
     framework's wording.
     - The back and neck questions show only for that region.
     - The weight loss amount and period show only after a yes.
     - Every question shown is mandatory (J2.4).
- **Later versions:** `hf-2` adds Part A consent (INT-06) and the guardian section (INT-07);
  `hf-3` has every J2.3 screen and ends with Check and submit (INT-05, below).

## The engine (`packages/schemas/src/health-form.ts`)

The engine is pure code, with no I/O.

| Part | What it is |
| --- | --- |
| `HealthFormDefinition` | A version and its screens |
| Screen | A key, a title, a source, fields, `showIf`, `awaitingApproval` |
| Field kinds | `yes_no` (stored as true or false), `number` (`unit`, `max`), `single_choice`, `multi_choice`, `text` |
| `showIf` conditions | `{ answer, is }` or `{ answer, in }`, naming earlier fields only (a test checks) |
| `parseScreen` | Reads a post. Every field shown on the earlier answers plus those just posted needs an answer ("Answer this question."). Hidden fields' values are ignored. |
| `pruneAnswers` | Drops answers that a change hid. For example, back to knee drops the back answers. |
| `resumeAt` | The first shown screen not complete, or `end`. A screen is complete once sent with every shown field answered. |
| `canOpen` | A screen opens only after the shown screens before it are complete. A screen not reached yet opens the one to carry on at. |
| `screenLayout` | Puts each follow-up under the question whose yes shows it, so the page works without scripts: CSS `:has()` shows follow-ups while that yes is ticked. |

## Versions

- `healthForms` keeps every published version. A saved form keeps its `form_version` for good.
- A test pins each version's sha256 digest. Any change to a published version fails it, so a change
  means a new version (for example `hf-2`): add it to `healthForms`, pin it, and set
  `currentHealthFormVersion`. Forms already started stay on their own version.

## Saving (`apps/web/modules/intake/services.ts`)

Patient writes go through `patientService` (`modules/access/service.ts`): one transaction as
`clinic_patient` with the link in its claims, under row level security, audited as `patient:<id>`.

The steps:

1. `verifyPatientLink` checks the token. It runs the same checks as opening the link, without
   logging another view.
2. The visit must be on: Checked in or In consultation (INT-03).
3. The screen must be shown and reachable.
4. `parseScreen`, then `pruneAnswers`.
5. `saveIntakeResponse` (`packages/db/src/intake.ts`) inserts the form, or updates it on conflict
   by appointment.

## Database (`intake_response`)

- **Columns:**
  - one row per appointment;
  - `patient_id`;
  - `patient_link_id`;
  - `form_version`;
  - `answers` (jsonb);
  - `done_screens`;
  - `submitted_at` (set by INT-05 and INT-10);
  - `assisted_by` (set by INT-09).
- **Audited** by the trigger.
- **Row level security for `clinic_patient`:** a patient reads, starts and saves only their own
  link's visit, only while the visit is Checked in or In consultation, and never once submitted.
  They never set `assisted_by` (no column right since INT-09) and set `submitted_at` only to now,
  once; nobody deletes a form.
- **Staff (INT-09):** those who check in, and clinicians, at the visit's centre read only `id`,
  `appointment_id`, `patient_id`, `assisted_by` and `submitted_at`; never the answers. Staff have no
  write right on the table; marking who helps goes through `internal.mark_health_form_assisted`.
  Support stays read only.

## The page

| Part | How it works |
| --- | --- |
| Welcome | "Hello <first name>", the visit, "It takes about 5 minutes.", then **Start** or **Continue** (gold, 56 px, pinned at the bottom) |
| Each screen | "Step n of m" with a bar, the title, the questions, then **Back** and **Next**. Yes and No are 64 px paired buttons. |
| A post with gaps | Comes back with "Please answer the questions marked below." and a message under each question. What was ticked stays ticked. |
| Without scripts | It all works as plain form posts. Patient pages send `Referrer-Policy: same-origin` (no longer `no-referrer`), because a plain post must carry its origin or Next refuses the server action. |
| On the tablet | The same page; the kiosk lock and idle reset apply to every screen |

## Part A consent (INT-06)

Blueprint Module 3: each statement is recorded with a tick, the time, its version and the
e-signature, and declining a mandatory one blocks the workflow and alerts reception.

Decisions (user, 23 October 2026):

- **Placement.** Part A is the form's first screen, "Pre-consultation consent" (form version
  `hf-2`). The questions open only after both statements are accepted and signed. Forms started
  on `hf-1` keep their version.
- **Statements.** `consentStatements` in `packages/schemas/src/consent.ts` holds the two
  statements, word for word from the Blueprint, at version 1. A test pins them, so new wording
  means a new version.
- **Signature.** A pad, for a finger or stylus, with Clear. The drawing is stored as a PNG in the
  private `signatures` bucket (at most 200 KB), uploaded by our server only. Without scripts the
  patient types their full name instead. `signature_kind` records `drawn` or `typed`.
- **Declining.** A decline records the declined statement, unsigned, and the screen shows
  "Please speak to reception." with **Change my answer**. Reception sees "Consent declined" as
  the form status in the check in drawer and as a tag on the Today row.
  - Records are never changed. A change of mind adds new records, and the latest decision for
    each statement counts (`latestConsent`, `partAConsentDeclined`).

How a consent screen is saved (`saveConsentScreen` in `apps/web/modules/intake/services.ts`):

1. `parseConsent` checks a decision for each statement. When all are agreed, it also checks for a
   PNG from the pad or a typed name.
2. A drawn signature is stored first, then recorded in one patient transaction. If the recording
   does not happen, for example because the visit closed, the file is removed.
3. Accepting both adds the screen to `done_screens`.

`consent_record`:

- **What a record holds:** stage, statement key and version, accepted, `signed_at`, the
  signature, the signer, and the appointment and link.
- **Filled later:** the episode with INT-10; the modality with Part B.
- **The check.** An acceptance is signed: a drawing with its file, or a typed name. A decline is
  never signed.
- **The patient adds** only their own health form link's visit, at stage A, signed by the
  patient, while the visit is on. They read their own records back.
- **Staff.** Those with check in rights read the records of appointments they can see. Nobody
  updates or deletes a record. Support is read only. Every record is audited.

## Guardian section (INT-07)

PRD J2.7: under 18 opens a guardian section; the guardian signs and must attend (the drawer
already says "A guardian must attend").

Decisions (user, 23 October 2026):

- **A guardian on file signs.** Under the adult age (`patients.adult_age_years`, 18), the consent
  screen shows "A parent or guardian signs for a patient under 18." and asks "Who is signing?".
  It lists the patient's guardians on file who are not removed, as a name and relationship (for
  example "Priya, Mother"), without phone numbers.
  - The chosen guardian agrees and signs, drawn or typed.
  - Every record stores `signer = guardian` and the guardian's id. Guardians are never deleted,
    so the record always names who signed.
- **No guardian on file.** The screen shows "Please speak to reception." The desk adds the
  guardian on the patient record (SCH-02), and the form then lists them.
- **Age unknown.** With no date of birth on file, the screen first asks "Is the patient under
  18?".
  - Yes opens the guardian section, shown by CSS while Yes is ticked, so it works without
    scripts.
  - No lets the patient sign.
  - Yes with no guardian on file shows the reception message, with Change my answer.
  - With a date of birth on file the age decides (`minorStatus`); About you (INT-05) brings the
    date of birth.

`parseSigner` (`packages/schemas/src/consent.ts`) decides who signs. A minor can never sign as
the patient.

Database:

- The check `consent_record_guardian`: a guardian's record names one; the patient's names none.
- `consent_record_patient_add` accepts `signer = guardian` only with one of the link's patient's
  guardians who is not removed (`guardian_patient_read`).
- Patient pages may read a guardian's `id`, `name` and `relationship` (never the phone), and the
  patient's `date_of_birth`.

## Screens (INT-05)

PRD J2.3: Part A consent; about you; your problem (region, body chart, complaint, onset, how it
started, duration, pain now and with activity 0 to 10, aggravating and easing); warning signs;
health check (pregnancy only for female); activity and goal; history with an optional report
photo; check and submit. About 5 minutes on a phone.

Decisions (user, 23 October 2026):

- **Body chart:** the whole body, front and back outlines, with 44 zones by area and side (for
  example "Right knee, front"). Several may be marked; checkboxes, so it works without scripts.
  - `bodyChartZones` (`packages/schemas/src/body-chart.ts`) gives each zone its region where one
    fits and its face: front for the knowledge base's Anterior subregions, back for Posterior.
  - The upper arm, thigh and shin or calf name no region.
- **Pain sliders:** "Pain now" and "Pain with activity", 0 to 10, ends worded "No pain" and "Worst
  pain you can imagine" (NPRS), with a readout ("6 out of 10"). Without scripts, a row of 0 to 10
  buttons. Untouched, a slider posts nothing.
- **Report photos** on History go to the private `reports` bucket as `patient_report` rows with
  `patient_link_id` set and no `uploaded_by`. The drawer lists them as "Added by the patient".
  Same types and `reports.max_file_mb` as INT-02; photos are shrunk on the phone first.
- **Mandatory:** the warning signs and the health check (J2.4), the body region (it decides the
  back and neck questions) and gender (it decides the pregnancy question, a precaution). Every
  other field is marked "(optional)" for the physio to complete.

Wording comes from the Blueprint's Module 2 fields and the SOP's intake list (occupation,
dominant side, goals). Every screen except Part A consent is `awaitingApproval` until the client
approves patient wording.

Engine additions: `optional` fields; `date`, `scale` and `body_chart` kinds; a "None of these"
option ticked alone (`exclusive`); options shown on earlier answers (`showIf`, pruned when hidden);
the `has` condition (Other (specify) while Other is ticked). About you starts from the patient
record (date of birth, sex, occupation) until the screen is sent; the record itself is not changed
here.

Check and submit lists every shown screen's answers ("Not answered" for empty ones) with Change.
Submit, in one patient transaction, sets `submitted_at` to now and completes the health form link
(`completePatientLink`). After that the link's page says "Thank you. Your answers are with your
physiotherapist.", Today shows Submitted, and nothing can be changed. The submit pipeline (episode,
red flags, precautions, AI job, physio notified) is INT-10.

Database (`20261023134407_health_form_submit_rules.sql`):

- `patient_report_patient_add`: a patient page adds reports only to its own visit, through its
  own link, with no `uploaded_by`, while the visit is on and the form is not submitted.
  `patient_report_patient_read` reads back only the reports added through that link.
- `intake_response_patient_save` allows `submitted_at` only as now; nothing is saved after.
- `patient_link_patient_complete`: the page's own working health form link completes once its
  form is submitted (`internal.health_form_submitted`, security definer, so the policies do not
  loop).
- Patient pages may read the patient's `sex` and `occupation`.

## Submit pipeline (INT-10)

PRD J2.6: on submit, the clinical episode is created; answers and consents are saved with form
versions; red flag rules run; precautions are stored; the AI preparation sheet is generated.

Decisions (user, 23 October 2026):

- **Rules:** the live knowledge base version's red flag rules run (SET-06), signed off or not. Each alert
  keeps the version and whether its rule was signed off, and the physio sees "awaiting clinical
  sign-off".
- **The physio is told in the app:** a Notifications link with the unread count on every staff
  page, and a list at `/app/notifications` that links to the visit on the calendar. Opening the
  list marks what it shows read. The count updates on each page load; realtime comes later.

How it runs (`apps/web/modules/intake/pipeline.ts`):

1. The patient's submit transaction also queues the job `intake.submitted` (`{appointmentId}`,
   key `intake.submitted:<appointment>`). Only that job is allowed to a patient page, for its own
   visit, once its form is submitted (`job_patient_intake_submitted`). So a submitted form always
   gets its pipeline.
2. Straight after the submit, the same request runs `processIntakeSubmission`. If that fails, the
   submit stands and the job runs it again within a minute (five tries, then a Super Admin task).
3. The pipeline runs as `system:intake`, in one transaction. It locks the form's row and does
   nothing for a form that already has its episode, so the job and the request never both act.
   - It opens the episode (patient, centre, body region from the answers), then moves it from
     Intake pending to Awaiting consultation through the episode machine. The episode is linked
     from the appointment, the form (`intake_response.episode_id`) and the visit's Part A consent
     records.
   - It runs `evaluateRedFlags` over the screening answers, with the age from the answered date
     of birth (else the record) and the `screening.*` settings. Each raised rule becomes a
     `red_flag_alert` (status Raised). With no knowledge base version, no rules run.
   - Each Health check item ticked (never "None of these") becomes a `precaution` with the label
     as the patient saw it and the form version.
   - It queues `ai.preparation_sheet` (`{episodeId}`, once per episode). Its handler checks the AI
     gate (AI-09, `docs/runbooks/ai-gate.md`) and does nothing while it is off; the AI gateway and
     sheet come with AI-01 to AI-03.
   - It notifies the visit's physio: "Health form submitted", and "Red flag: emergency" when a
     raised rule's display is emergency.
4. The drawer and Today keep showing the visit's own form, now Submitted
   (`needsHealthForm(appointment, latestLink)`).

Reviewing, referring and closing alerts, and the emergency banner, are ALT-01; the modality
precaution warnings are CLN-07 and SES-05.

Database (`20261023145017_submit_pipeline_rules.sql`):

- `red_flag_alert` and `precaution`: read by staff who treat patients, at a centre they see. Only
  the system writes them.
- `notification`: read by the staff member it is for, who may change only `read_at`.
- `job`: the patient insert policy above; support stays read only.

## Assisted mode (INT-09)

PRD J2.5: the record shows who helped. Decisions (user, 23 October 2026):

- **Start:** "Fill in with the patient" in the check-in drawer, for a checked in visit whose form is
  not sent. The staff member is recorded as helping, then "Open the form" opens the patient's form in
  a new tab on that device. "Show QR" and "Open on tablet" still work. The patient still signs Part A.
- **Shown:** "Entered with help by <name>" in the drawer, before and after submit, and on the
  physio's "Health form submitted" notification. The consultation screen shows it when it is built.
- **How it is recorded:** `fillInWithPatient` (`apps/web/modules/front-desk/services.ts`, the
  `check_in.manage` permission at the visit's centre) gets or issues the visit's link, then calls
  `internal.mark_health_form_assisted(visit, link, version)`. The function:
  - refuses (false) anyone who does not check in, Velyx support, a visit not checked in at a centre
    they see, a link that is not the visit's health form link, and a form already sent;
  - records the signed in staff member only (`jwt_staff_id()`), whatever the caller passes;
  - starts the form if the patient has not yet (no screens done, so the patient still sees Start);
  - is audited as the staff member by the trigger.
- **Why a function, not table rights:** Supabase grants `authenticated` every right on public tables
  by default, so column grants mean nothing until those are revoked; and Drizzle's insert lists
  every column, so a column-limited insert right cannot work. The function keeps staff to one
  column, checked in one place.

## Returning patients (INT-08)

PRD J2.8: "Returning patients get prefilled details with 'Has anything changed?'". The documents
say nothing more, so these are recommended defaults, chosen under the user's standing approval of
28 October 2026 (DECISION register, INT-08).

- **Returning:** the patient's newest health form submitted for another visit within
  `intake.carry_over_months` (placeholder 24) gives at least one carried answer that the current form
  still takes. A first form, or one that gives nothing, works as before.
- **Carried:** date of birth, sex and occupation (the patient record wins, as INT-05), dominant
  side, activity, Other (specify), level and hours, injuries, surgeries and investigations. Each is
  read again as if posted today (`readAnswer`), so an answer the field would refuse is dropped.
- **Asked again every time:** Part A (signed on every form), the problem, the warning signs (the
  red flag rules), the health check (precautions; PRD J2.4 "mandatory"; pregnancy) and the goals.
  Report photos are not carried; they belong to the visit.
- **The review:** after Part A the form opens "Has anything changed?" (`?screen=changes`): the
  details by screen, "These details are from your form on <date>", No changes, Something changed,
  and Back (to Part A).
  - **No changes:** the details join the answers on the screens the patient has not sent in this
    form (a screen they sent is theirs, a cleared answer included), and About you and History, which
    hold only carried fields, count as sent when complete. Activity is shown, filled in, for
    today's goals. The patient goes on to Your problem.
  - **Something changed:** the carried screens open filled in with "Filled in from your last form.
    Change anything that is different." (only on a screen with a carried answer). After No changes,
    the screens it filled, still exactly as carried, are to be sent again; one the patient changed
    since stays sent.
  - Check and submit shows the answer with Change, so it can be changed until submit; giving the
    same answer again changes nothing.
- **The gate, in code:** until the review is answered no screen other than Part A is saved and the
  form is not submitted (`standing` and `submit` in `apps/web/modules/intake/services.ts`); the page
  sends any other screen to the review. The earlier form is always found again on the server; the
  browser posts only yes or no.
- **Database** (`20261028002041_returning_prefill.sql`, `20261028002138_returning_prefill_rules.sql`):
  - `intake_response.carried_from_id` and `details_changed`, set together or not at all (a check).
  - `internal.health_form_carry_source(keys, months, chosen)`, for `clinic_patient` only: the link's
    patient's newest submitted form for another visit within the months (or the one already
    chosen), while the link's visit is on, cut in SQL to the keys asked for. The problem, warning
    sign and health check answers never leave the database.
  - `intake_carry_guard`: `carried_from_id` names the same patient's submitted form for another
    visit, whoever writes it.
  - The patient may update the two columns, under the existing save policy (their visit, while on,
    before submit). Audited as the patient.
  - `internal.consultant_health_form` also returns `details_changed` and when the carried form was
    submitted, for the same people as before.
- **The consultation** says "Returning patient: details carried over from the health form of
  <date>. The patient said nothing changed" (or something changed).
- **Assisted mode and the kiosk:** the same flow on that device.
- **Wording:** the review's wording awaits the client's approval of patient wording, as the
  screens.
- **Review (28 October 2026):** an adversarial review found that answering the review again could
  bring back an answer the patient had cleared, or send them through screens they had sent; that
  the note showed on screens with nothing carried; and that the review had no Back. All four are
  fixed with tests.

## Checking it

| Test | What it proves |
| --- | --- |
| `packages/schemas/src/health-form.test.ts` | Region questions; follow-ups after a yes; pruning; every shown answer needed; resume and order; layout; conditions name earlier fields; versions pinned |
| `apps/web/modules/intake/services.test.ts` | Starts on the current version; asks for answers; prunes and keeps the version; no screen early; nothing saved for a closed visit or a link that isn't a working health form link |
| `packages/db/src/integration/intake.integration.test.ts` | Saved by its patient while the visit is on, audited as the patient; refused for another visit, a visit not on, and once submitted; no delete; no staff read |
| `packages/schemas/src/consent.test.ts` | Wording pinned; a decision for each statement; a signature only to agree, drawn or typed; a bad or too large picture refused; the latest decision counts |
| `apps/web/e2e/consent.spec.ts` | 360 px and desktop. A decline blocks the form, and reception sees it on Today and in the drawer. Changing their mind and signing on the pad opens the questions, and the signature is stored. Agreeing needs a signature. Without scripts, a typed name signs. |
| `apps/web/e2e/guardian.spec.ts` | 360 px and desktop. A guardian on file signs for a 12 year old, and the records name them. Without a date of birth the form asks; under 18 with no guardian waits for reception; No lets the patient sign. Without scripts, the question opens the section. |
| `packages/schemas/src/health-form-screens.test.ts` | `hf-3` screens; only the region, gender, warning signs and health check needed; dates; sliders 0 to 10; chart zones; pregnancy only for female and pruned; None of these alone; Other (specify) under Other; zones unique and on the outline |
| `apps/web/e2e/health-form-screens.spec.ts` | 360 px and desktop. The whole form with the chart, sliders and a report photo; Check and submit reads it back; Submit thanks the patient; the desk sees Submitted and "Added by the patient". No pregnancy for a male patient. Without scripts: chart boxes, 0 to 10 buttons and a submit. |
| `packages/schemas/src/intake-submit.test.ts` | Screening answers picked for the rules; the age from the form or the record; precautions from the Health check, never None of these |
| `apps/web/modules/intake/pipeline.test.ts` | Episode opened and moved; rules raised with the version and sign-off; precautions; the AI job; the physio told, twice for an emergency; a second run does nothing; not submitted refused; no knowledge base version |
| `apps/web/e2e/submit-pipeline.spec.ts` | 360 px and desktop. A back form with a saddle numbness yes: episode Awaiting consultation, emergency alert, precautions, AI job, two notifications; the physio's count and list, read on opening; the desk still sees Submitted. An all clear form: no alerts or precautions, one notification. |
| `apps/web/e2e/assisted.spec.ts` | 360 px and desktop. The desk presses "Fill in with the patient", sees who helps, opens the form from "Open the form"; the patient signs and submits; the drawer shows Submitted and "Entered with help by <desk>", and so does the physio's notification. |
| `apps/web/e2e/health-form.spec.ts` | 360 px and desktop: screen by screen with messages and region questions; leave and Continue; all answered on `hf-1` by the patient; a closed visit saves nothing; without scripts |
| `packages/schemas/src/returning.test.ts` | Only the details carried, never the problem, warning signs, health check or goals; the record wins; refused or hidden answers dropped; nothing carried makes no returning patient; the review due after Part A until answered; No changes fills About you and History but not Activity, and not About you without sex; Something changed sends them again |
| `apps/web/modules/intake/services.test.ts` (a returning patient) | No other screen and no submit before the review; No changes and Something changed save the right answers and screens with the earlier form found on the server; no review before Part A, after submit or without an earlier form |
| `packages/db/src/integration/returning.integration.test.ts` | Only the carried keys of the patient's own latest submitted form for another visit, within the months; nothing unsubmitted, from the same visit, or once the visit is not on; never another patient's form; the review needs both columns and is audited as the patient; nothing after submit; staff never run the function; the consultant reads the review |
| `apps/web/e2e/returning-patient.spec.ts` | 360 px and desktop. The review lists the details, not the problem; nothing opens before it; No changes goes to Your problem, asks the warning signs and health check again, shows Activity and History filled in, and submits with the earlier form recorded. Something changed opens About you filled in with the note; the answer can be changed and the patient's own change stands. |

**Negative checks (23 October 2026):**

- With `intake_response_patient_start` dropped, 2 database tests and the first end-to-end test
  failed (INT-04).
- With `consent_record_patient_add` dropped, the database test and the decline end-to-end test
  failed (INT-06).
- With the policy accepting any `guardian_id`, the database test refusing another patient's
  guardian failed (INT-07).
- With `patient_report_patient_add` dropped, 2 database tests and the whole form end-to-end test
  failed (INT-05).
- With `job_patient_intake_submitted` dropped, the database test and the submit end-to-end test
  failed: the submit was refused, so nothing was submitted (INT-10).
- With `internal.mark_health_form_assisted` dropped, the assisted database test failed (INT-09).
- With the same patient check taken out of `intake_carry_guard`, the database test refusing another
  patient's form failed; with the review gate taken out of `standing`, the service test refusing
  screens before the review failed (INT-08, 28 October 2026).
