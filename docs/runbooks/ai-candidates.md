# Preparation sheet candidates and must rule out (AI-02)

## Sources

- **PRD section 6, "How the preparation sheet works":**
  - Step 1: "Code filters the 354 knowledge base rows to about 15 to 25 candidates by region, age,
    sex, onset and duration".
  - Step 2: "Matching high risk rows go to "Must rule out" by rule, whatever the model says".
- **TAD section 6, steps 2 and 3:** code filters, and the model only ranks (AI-03).
- **AI-02, ticket text:** "15 to 25 rows by region, age, sex, onset, duration; matching high risk
  rows always added".

## Where it runs

The pure function is `shortlistCandidates` in `packages/schemas/src/candidates.ts`. `candidateCase`
builds the case from the health form.

`buildCandidates` (`apps/web/modules/ai/candidates.ts`) runs the preparation sheet job's filter.
That job runs only while the AI gate is on (AI-09, `docs/runbooks/ai-gate.md`).

- **Input:** the episode's latest submitted health form, with the date of birth, sex and body
  region on file for anything the form did not ask (`episodeCandidateInput`).
- **Knowledge base:** the listings of the version the gate was switched on for (`pass.kbVersionId`),
  never another.
- **Output:** nothing is stored yet. AI-03 stores the shortlist with the ranking (`ai_run`), and
  the recheck (AI-04) reuses it.
- **No identifiers:** the case holds no name, phone number or ID (rule 11).

## Rules

These are recommended defaults, chosen under the user's standing approval of 28 October 2026. They
are recorded as DECISION AI-02 in `docs/PROGRESS.md`. The rules read only what the workbooks
state and weight nothing clinically.

- **Region is the only hard filter.** The shortlist uses the workbook of the patient's region.
  Subregion is not used: the body chart's zones do not map to the workbooks' free text subregions.
  The client can supply that mapping as data.
- **Age, onset and sex only order the rows.** Matching the region strictly on all four leaves 7 to 8
  rows, short of 15. Within the region, rows are ordered by:
  1. an age mismatch last;
  2. then an onset mismatch;
  3. then the other sex's predominance;
  4. then more stated matches first;
  5. then the workbook's own row order.
- **How each field matches:**
  - **Age:** inclusive at both ends, read as the workbooks' age column was read (never narrower
    than the text).
    - Three rows state the age at onset: "Under 45 at onset" for LUM-020 and HIP-035 (cervical),
      and "10-20 (onset)" for LUM-015.
    - These are checked against the age the problem started at, worked out from the duration,
      using every whole age the duration allows.
    - Without a duration they say nothing either way.
  - **Onset:** a mismatch only when the row states gradual or sudden, and not the patient's answer.
    A row that is only recurrent or subacute, or a question left unanswered, says nothing either way.
  - **Sex:** a predominance only, so it never excludes a row. "Other", unknown and "equal" are
    neutral.
- **How many rows:**
  - The shortlist takes the rows with no age or onset mismatch, kept between `ai.candidates_min`
    (15) and `ai.candidates_max` (25).
  - If there are more, they are cut in the order above.
  - If there are fewer, the next rows fill the gap, each showing its mismatches.
  - A region smaller than the minimum is taken whole.
  - If the minimum is set above the maximum, the maximum wins.
- **Must rule out:** every row of the region whose red flag tier is in `ai.must_rule_out_tiers`
  (default: Red flag) and whose age range admits the patient's age.
  - When the age is unknown, every such row goes in.
  - Onset and sex never narrow it, because feedback never weakens safety (PRD).
  - These rows sit outside the count and are never cut.
  - A row both chosen and high risk is listed once, with both marks.
- **Duration and activity** are carried for the model (the TAD sends duration and sport) but not
  matched. No workbook column holds symptom duration; "Expected Timeline" is recovery time.
- **Bone Stress** rows have no body region, so they are never chosen.
- **Thoracic:** there is no thoracic workbook. A marked "Upper back" zone raises the gap
  `no_thoracic_workbook`, so AI-03 can say so.

## Waiting for the client (DECISION AI-02)

- Duration matching.
- A mapping from body chart zones to subregions.
- Whether Conditional rows, or the red flag alerts raised at intake, should add must rule out rows.
- Bone Stress regions.
- The thoracic workbook (OPS-02).
- Activity matching.

## Tests

- `packages/schemas/src/candidates.test.ts` covers the rules case by case, on generated rows:
  - cutting and filling;
  - sex, onset and age;
  - must rule out;
  - order does not matter;
  - gaps;
  - the case built from the form.
- `packages/db/src/knowledge/candidates.test.ts` runs the real workbooks for every region and a
  grid of ages, sexes and onsets.
  - Every result has 15 to 25 rows.
  - Every result includes exactly the region's Red flag rows for the age.
  - Narrowing must rule out to rows whose age range states a match fails this test.
  - It pins axial spondyloarthritis in Must rule out for a 52 year old whose pain started at 44.
- `packages/db/src/integration/consultations.integration.test.ts` checks that the filter reads the
  episode's submitted form, never a draft, with the date of birth and sex on file.
- `apps/web/modules/ai/candidates.test.ts` and `preparation-sheet.test.ts` check that:
  - the pass's version and the settings are used;
  - nothing is built while the gate is off.
