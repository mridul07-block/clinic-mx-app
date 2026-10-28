# AI preparation sheet (AI-03)

## Sources

- **PRD section 6, "How the preparation sheet works":**
  - Step 3: "The model ranks the shortlist and returns condition IDs with a one line reason."
  - Step 4: "Code checks every ID exists on the shortlist; anything else is dropped."
  - Step 5: "The discriminating question, special tests and rationale are shown word for word from
    the knowledge base."
  - Step 6: "The physio keeps or dismisses each suggestion; nothing enters the record until the
    physio confirms it."
  - "The sheet shows the top 3 suggestions expanded and 2 under "Also consider"".
- **TAD section 7, steps 5 to 7.**
- **Frontend Specification:** "Preparation sheet", "AI suggestion card", and My patients today's
  "Preparation sheet ready".
- **AI-03, ticket text:** "Unknown IDs dropped; knowledge base text shown word for word; Keep and
  Dismiss stored; ready within 15 s".

## Status: partly done

The sheet, validation, storage, screen and marker are built. There is no OpenRouter key, and no
model has been chosen (AI-01, AI-06), so every real sheet today is unavailable (not configured):
- it still shows Must rule out, Safety and What the patient told us;
- in the place of suggestions it shows "Suggestions unavailable right now. Continue the
  consultation as usual."

Ranked sheets are proven with a fake model in unit tests and with a seeded sheet end to end.

These are recommended defaults, chosen under the user's standing approval of 28 October 2026, and
recorded as DECISION AI-03 and decision 3 in `docs/PROGRESS.md`.

## How a sheet is made (`apps/web/modules/ai/preparation-sheet.ts`)

1. **When.** The health form submit runs the sheet straight after the patient has their answer
   (`after()` in `submitHealthForm`, through `prepareSheetNow`). The queued `ai.preparation_sheet`
   job is the retry.
2. **The AI gate (AI-09).** While it is off, nothing happens and no sheet is made, even later.
3. **The shortlist (AI-02)** is built from the episode's submitted form, over the gate's knowledge
   base version.
4. **The claim.** The sheet row is taken (`claimSheet`), so two runs never both pay for a model
   call.
   - While another run holds it, the job fails on purpose, and the queue tries again after its
     backoff.
   - A run that stopped half way leaves the sheet pending. The job takes it over once that claim
     is older than `ai.sheet_retry_after_seconds` (60).
   - A run finishes the sheet only while it still holds its claim (`finishSheet`), so a run that
     was taken over writes nothing.
5. **What is sent (AI-01).** The case holds the TAD's fields only:
   - symptoms: the pain zones, the main complaint, how it started, and what aggravates and eases
     it;
   - sport: the activities;
   - goal: the patient's goals;
   - each cut to 200 characters;
   - a mistyped age (over 120) or an impossible duration is sent as unknown.

   The shortlist rows go out numbered, in the knowledge base's own words. The patient's and
   guardians' name words are never sent.
6. **Validation** (`validateRanking`, `packages/schemas/src/ai-sheet.ts`):
   - a number not on the shortlist is dropped;
   - a condition ranked twice keeps its first place;
   - the first `ai.sheet_top_count` (3) are the top suggestions, and the next
     `ai.sheet_also_consider_count` (2) go under Also consider;
   - nothing is added that the model did not rank;
   - no valid suggestion means the sheet is unavailable, `no_valid_suggestions`.
7. **Stored:** the sheet (`ai_preparation_sheet`) with its shortlist, the de-identified case, its
   knowledge base version, its status (ready, or unavailable with why) and when it was ready; and
   one `ai_suggestion` row per suggestion, tied to its `ai_run`.

**Must rule out** is the shortlist's own Red flag rows (AI-02), stored on the sheet by rule. It is
shown whatever the model says, and has no Keep or Dismiss. A must rule out row the model also
ranked shows as a suggestion too.

## Who sees what

- **The sheet:** `/app/episodes/{episodeId}/preparation-sheet`, for consultants (Consultant tick)
  at a centre that sees the episode, while the AI gate is on. Otherwise the page is not found, or
  not allowed.
- **"Preparation sheet ready":** on My patients today, for a made sheet (ready or unavailable),
  until a consultation on the episode is signed.
- **The panels:**
  - Likely diagnoses: the top 3 open, Also consider folded.
  - Suggested examination: the row's examination findings.
  - Load and biomechanics: the row's biomechanical cause.
  - Safety: the episode's open red flag alerts.
  - Must rule out: each row folded to its name; its red flag, question and tests open on tap.
  - What the patient told us: the case that was sent.
- **Word for word:** every clinical word (condition name, discriminating question, tests,
  examination, biomechanics, red flag) is the knowledge base's own, from the sheet's version,
  shown exactly as stored.
- **The model's words:** its one line reason is shown under "Assistant suggestion".
- **Keep and Dismiss** belong to the consultant of a visit on the episode that still stands, and
  only until a consultation on the episode is signed. The service checks this
  (`recordDisposition`), and so does the database (`internal.ai_sheet_disposer`, the
  `ai_suggestion_dispose` policy, and a grant on the disposition columns only). A choice can change
  between Kept and Dismissed; every change is audited. Nothing enters the record: the
  consultant's own diagnosis is the confirmation.

## Measuring the 15 seconds

```sql
select s.ready_at - f.submitted_at
from ai_preparation_sheet s
join intake_response f on f.episode_id = s.episode_id;
```

Two attempts of 6 seconds (AI-01's defaults) stay inside 15 seconds. A task timeout raised past
7 seconds can break it.

## Tests

- `packages/schemas/src/ai-sheet.test.ts`:
  - unknown and repeated rows dropped;
  - the counts;
  - nothing padded;
  - the case sent: only the TAD's fields, cut.
- `apps/web/modules/ai/preparation-sheet.test.ts`:
  - gate off;
  - ranked and validated;
  - unavailable with the gateway's reason, keeping must rule out;
  - no valid suggestion;
  - no region or no form, so no model call;
  - a taken sheet is never paid for twice.
- `apps/web/modules/intake/services.test.ts`: the sheet is made after the submit.
- `packages/db/src/integration/ai-sheet.integration.test.ts`:
  - who reads;
  - only the visit's consultant keeps or dismisses, audited;
  - nothing else changes;
  - closed once signed;
  - written by nobody signed in;
  - claimed once;
  - finished only by the run holding the claim (dropping that check fails this test).
  - Dropping the visit's physio check fails this test.
- `apps/web/e2e/preparation-sheet.spec.ts`, at 360 px and on desktop:
  - a seeded sheet read word for word against the database;
  - Keep and Dismiss stored;
  - a physio without the tick and the gate off are both refused;
  - the real submit makes an unavailable sheet within 15 seconds, with its must rule out rows.

## Later

- Recheck with findings (AI-04).
- Similar cases (AI-05).
- The dispositions report (AI-08).
- Kept suggestions offered first in the Assessment picker.
- A page per knowledge base row for the source link.
