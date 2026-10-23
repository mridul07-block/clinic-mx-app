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
- **Coming later:**
  - the other J2.3 screens and Check and submit, with INT-05;
  - Part A consent with INT-06, and the guardian section with INT-07.
- **No submit yet.** After the last screen the patient sees "Your answers are saved."

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
  They never set `assisted_by` or `submitted_at`, and nobody deletes a form.
- **Staff:** no policy yet. The consultation and INT-10 add their reads. Support stays read only.

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
- **Guardians.** Under 18s get the guardian's signature with INT-07.

## Checking it

| Test | What it proves |
| --- | --- |
| `packages/schemas/src/health-form.test.ts` | Region questions; follow-ups after a yes; pruning; every shown answer needed; resume and order; layout; conditions name earlier fields; versions pinned |
| `apps/web/modules/intake/services.test.ts` | Starts on the current version; asks for answers; prunes and keeps the version; no screen early; nothing saved for a closed visit or a link that isn't a working health form link |
| `packages/db/src/integration/intake.integration.test.ts` | Saved by its patient while the visit is on, audited as the patient; refused for another visit, a visit not on, and once submitted; no delete; no staff read |
| `packages/schemas/src/consent.test.ts` | Wording pinned; a decision for each statement; a signature only to agree, drawn or typed; a bad or too large picture refused; the latest decision counts |
| `apps/web/e2e/consent.spec.ts` | 360 px and desktop. A decline blocks the form, and reception sees it on Today and in the drawer. Changing their mind and signing on the pad opens the questions, and the signature is stored. Agreeing needs a signature. Without scripts, a typed name signs. |
| `apps/web/e2e/health-form.spec.ts` | 360 px and desktop: screen by screen with messages and region questions; leave and Continue; all answered on `hf-1` by the patient; a closed visit saves nothing; without scripts |

**Negative checks (23 October 2026):**

- With `intake_response_patient_start` dropped, 2 database tests and the first end-to-end test
  failed (INT-04).
- With `consent_record_patient_add` dropped, the database test and the decline end-to-end test
  failed (INT-06).
