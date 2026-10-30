# Similar confirmed cases and the confirmed diagnosis (AI-05)

## Sources

- **Ticket AI-05:** "3 to 5 past episodes confirmed at review or discharge; no identifiers".
- **TAD section 7, step 4:** "Similar cases (code): fetch 3 to 5 past episodes with similar answers
  whose diagnosis was confirmed at review or discharge (no identifiers)."
- **PRD section 6:**
  - "From month one, 3 to 5 similar confirmed past cases (no identifiers) are shown to the model and
    the physio."
  - "The learning label is the diagnosis confirmed at review or discharge, not the first
    impression."
- **TAD section 7:** "Recheck with findings" runs steps 5 to 7 again, and the blind test reruns
  whenever the model, prompt or knowledge base changes.

No document says how "similar" is measured, who confirms a diagnosis, or where the cases show.
Every choice below is a recommended default chosen under the user's standing approval, 29 October
2026 (DECISION AI-05 in `docs/PROGRESS.md`), for the client to confirm.

## Status: partly done

- Built and tested: confirming the diagnosis, choosing the cases, storing and showing them, and
  sending them to the model with the v2 and v3 prompts.
- Waits for the OpenRouter key, like every ranked sheet (AI-01, AI-03): until then the cases are
  chosen and shown, and the model is not called.
- Waits for consultants to confirm diagnoses: until 3 confirmed cases of a region exist, its
  sheets say "Not enough confirmed past cases like this one yet."

## The confirmed diagnosis (the learning label)

Nothing recorded a diagnosis at review or discharge before AI-05: the only diagnosis is the one
signed in the consultation. So AI-05 adds it.

- **Where:** a "Confirmed diagnosis" panel on the Review and discharge screen
  (`episodes/[episodeId]/review/confirm-diagnosis-form.tsx`).
- **What it shows:**
  - the diagnosis at the consultation;
  - the latest confirmation, with the "Confirmed diagnosis" label (Frontend Specification source
    labels), At review or At discharge, and "changed from the consultation" when it differs.
- **Who:** a consultant with the Treats patients tick. Physios without the Consultant tick, and
  Super Admins, read it.
- **When:** never the first impression. Only once the episode has been reviewed (Under review, its
  session 4 reassessment signed, or its final testing signed) or discharged
  (`internal.episode_reviewed`, checked by the service and the guard). Before that the panel says
  so and has no button.
- **What they do:** confirm the signed condition as it stands, or change it with the same condition
  search as the Assessment, within the signed diagnosis's knowledge base version. Enter in the search
  only picks a condition; it never submits a confirmation.
- **Never edited:** each confirmation is a new row; the latest is the label. Nobody updates or
  deletes one.
- **Table:** `confirmed_diagnosis` (episode, source diagnosis, knowledge base version and condition,
  stage, who, when). `internal.confirmed_diagnosis_guard`:
  - refuses anyone but an active consultant with the Treats patients tick (never Velyx support or
    the system);
  - refuses anything but the episode's latest signed diagnosis and its version;
  - refuses an episode not yet reviewed or discharged;
  - stamps the stage (Discharge once the episode is discharged, else Review), who and when
    (`clock_timestamp()`, so two in one transaction still order).

  Row level security: clinical readers read it; inserts need the Consultant and Treats patients
  ticks and the caller as the author; no updates or deletes; audited.
- **Code:** `packages/db/src/confirmed-diagnosis.ts`, `apps/web/modules/reviews/confirm-diagnosis.ts`
  (`confirmEpisodeDiagnosis`, `consultant_records.sign`).

## Choosing similar cases (`packages/schemas/src/similar-cases.ts`)

Pure and deterministic, like the candidate filter (AI-02). Nothing is weighted.

- **The pool** (`similarCasePool`, read by the system): every episode with a confirmed diagnosis, at
  any centre, but the patient's own. Each brings its latest confirmation and its latest submitted
  health form, read as the candidate filter reads a form, with the age at that form's date.
- **Kept:** the same body region, another patient, another episode.
- **Order**, each step breaking the last's ties:
  1. no onset mismatch (both stated and different);
  2. no other stage band from the duration, by the Assessment's own thresholds
     (`assessment.acute_weeks_below`, `assessment.chronic_weeks_above`);
  3. more pain zones shared;
  4. sex not the other one;
  5. nearer age;
  6. more activities shared (not "Not active" or "Other");
  7. most recently confirmed.

  An unknown onset, stage, sex or activity counts as neither like nor unlike; an unknown age comes
  after every known one.
- **How many:** at most `ai.similar_cases_max` (5). Fewer than `ai.similar_cases_min` (3) and there
  are none, so a thin pool never speaks for a case.
- **What each case holds:** age, sex, region, the pain zones and activities by their labels, the
  duration, the confirmed condition's name, and its row number on this sheet's shortlist (or none).
  Never free text, goals, dates, centres, names, numbers or IDs (`aiSimilarCaseSchema` is strict).
- **The guard:** a case the identifier guard would refuse (for example a condition name holding a
  word of this patient's name) is skipped for the next one, before the cut, rather than holding the
  sheet back.

## Where they go

- **The sheet:** chosen before the sheet is claimed, stored as sent in
  `ai_preparation_sheet.similar` (null on sheets made before AI-05), and shown as "Similar confirmed
  cases" after Load and biomechanics: read only, no Keep or Dismiss.
- **The model:** sent with `rank_diagnoses.v2` or `.v3`, which say the cases are context only and
  that only the shortlist's rows are ranked. A v1 prompt is never sent them. The settings migration
  moved both clinical tasks to v2, and AI-03's live run to v3 (only the rows the sheet shows).
- **The recheck (AI-04):** sends the sheet's own cases again with `recheck_with_findings.v2` or
  `.v3`; it never fetches again.
- **The blind test (AI-06):** each case's similar cases are the file's other cases, by the same rule,
  never itself. `report.json` records each prompt version's hash.

## Before the AI gate is switched on

The prompts changed, so the blind test runs again on the prompts in the task settings, v3 since
31 October 2026 (TAD section 7), before the Super Admin records the pass.

## Tests

- `packages/schemas/src/similar-cases.test.ts`: the filters; each step of the order; unknowns
  neutral; none under the minimum, at most the maximum; structured fields only, the strict schema.
- `packages/schemas/src/confirmed-diagnosis.test.ts`: what confirming posts.
- `apps/web/modules/ai/similar-cases.test.ts`: each case read at its own form's date, the patient's
  own excluded, a case the guard refuses left out, none when that leaves too few.
- `apps/web/modules/ai/preparation-sheet.test.ts`, `recheck.test.ts`, `gateway/run.test.ts`,
  `blind-test.test.ts`: claimed and sent as chosen; the recheck reuses them; only v2 and v3
  prompts get them and an extra field is refused; leave-one-out in the blind test.
- `apps/web/modules/reviews/confirm-diagnosis.test.ts`: confirm or change; the refusals; the panel.
- `packages/db/src/integration/confirmed-diagnosis.integration.test.ts`: who confirms, stamped and
  audited, never changed; At discharge after discharge; refused against anything but the latest
  signed diagnosis; the pool across centres without the patient's own, with the latest confirmation.
  Dropping the source diagnosis check from the guard fails this test.
- `apps/web/e2e/confirmed-diagnosis.spec.ts`, `preparation-sheet.spec.ts`, at 360 px and desktop:
  confirm then change, a physio reads it; the seeded sheet's similar cases without names, dates or
  IDs; the real submit stores its list.
