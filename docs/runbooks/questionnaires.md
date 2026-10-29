# Questionnaire library

SET-08: "Questionnaire library: items, scoring, meaningful change and versions for each instrument".

Sources:
- PRD M10: "Questionnaire library with versions, raw answers and automatic scoring".
- PRD section 6: scoring is a fixed, tested rule, never AI.
- TAD `kb_questionnaire`: "instrument, version, items, scoring rule, meaningful change".
- Blueprint Module 8.
- Blueprint section 10: "Calculate scores consistently and handle missing responses and scoring limitations explicitly".

Every choice below is a recommended default chosen under the user's standing approval, 29 October 2026 (DECISION SET-08), for the client to confirm.

Patients fill questionnaires with OUT-02.

## What the library holds

Each of the 19 Blueprint instruments (`packages/db/src/knowledge/plan-catalog.json`, CLN-07) is a `kb_questionnaire` row in each knowledge base version. It holds three new things.

**`definition`:** the instrument as the clinic supplies it. `questionnaireDefinitionSchema` in `packages/schemas/src/questionnaires.ts` validates it on import, so a bad file never imports. It contains:
- its own version;
- the patient instructions, word for word;
- its items. Each item is one of:
  - a choice of worded answers, each scoring its value;
  - a scale between two worded ends;
  - an activity the patient names and rates (PSFS).
- the scoring rule;
- the range of scores;
- which direction is better;
- the meaningful change value (null until given);
- where all of this comes from.

**`licence`:** one of:
- `unconfirmed` (the default);
- `free`;
- `licensed`.

**`signed_off`:** the clinical lead's sign-off.

A patient fills an instrument only when it has a definition, a confirmed licence and sign-off (`questionnaireFillable`). The database refuses a signed-off row without a definition object or with an unconfirmed licence (`kb_questionnaire_sign_off`). The import refuses the same in the committed file.

## Scoring

`scoreQuestionnaire` scores a set of answers deterministically:
- **`sum`:** the answers added up. With items missing (no more than `maxMissing`), the sum of those answered is scaled to all items.
- **`mean`:** the average of the answers given.
- **`percent`:** points scored over points possible on the items answered, as 0 to 100 (the Oswestry style). `invert` gives 100 less that, where higher is better.

**Missing answers:**
- An answer the item does not allow counts as missing.
- With more items missing than the rule allows, there is no score. The result says "too many missing", never a guess.

**Rounding:** scores round to one decimal place, half away from zero. Percent multiplies before it divides, and rounding reads 15 significant digits first, so an exact half such as 23 of 80 points (28.75%) rounds up to 28.8.

**What a definition must agree with:**
- The `range` is what the rule can give: 0 to 100 for `percent`, the items' summed lowest to highest for `sum`, and the items' shared range for `mean`.
- `mean`, and `sum` with any item allowed missing, need every item to score over the same range. Standing answered items in for missing ones, or averaging, means nothing otherwise.

**Meaningful change:** `changeFromBaseline` gives the change, positive when better by the instrument's direction, and `met`, whether it reaches the meaningful change. `met` is null while the instrument has no meaningful change value.

## Where it shows

The knowledge base version page has a **Questionnaires** section. It shows each instrument with what it still waits for:
- Awaiting items and scoring;
- Awaiting licence;
- Awaiting clinical sign-off;
- Ready to fill.

It also gives the version, the number of items and the meaningful change once a definition exists, and a line for how many can be filled. The Super Admin's approval note counts the questionnaires awaiting sign-off with the rules and modality links. Approving a version does not sign them off.

## What the clinic supplies

No item wording, scoring or value is in the documents or workbooks, so none is written here: they are clinical content and often copyrighted.

**Per instrument:**
- the final version and its items word for word;
- the response options and the scoring rule, with missing-answer limits;
- the range and the better direction;
- the meaningful change value;
- the licence;
- the clinical lead's sign-off.

**The final list** (Blueprint open item 5):
- one of each pair: WOMAC or Oxford Knee, Harris Hip or Oxford Hip, iHOT-12 or iHOT-33;
- how to reconcile the SOP's LEFS, DASH and ACL-RSI with the Blueprint list;
- what to do about the Harris Hip Score's clinician-examined items.

**Meaningful change values in the documents:** the lumbar workbook names ODI about 10 points and PSFS 2 points. They go in with those instruments' definitions once the clinic confirms them.

**Licences:** the PRD flags WOMAC and the Oxford scores as paid.

Each instrument is added by editing `plan-catalog.json` and importing, which makes a new knowledge base version. Records keep the version they used.

## Tests

| File | Covers |
| --- | --- |
| `packages/schemas/src/questionnaires.test.ts` | a definition accepted, and refused, each for its own reason, with a key twice, everything allowed missing, an inverted sum, a zero change, a one-point scale, two answers scoring the same, a range the rule cannot give, and mixed item ranges for mean or sum with missing items; sum with and without an allowed missing item and none past it; a disallowed answer as missing; mean and percent, inverted; exact halves rounded up (28.75 and 38.75); points from each item's lowest answer; scales and activities; the change from baseline both ways, fractional, met or not, null without a value; the gate's four states and the summary for none, one and several |
| `packages/db/src/integration/knowledge.integration.test.ts` (questionnaire library) | imported with a definition, licence and sign-off from the file, every other instrument awaiting all three, 18 counted for sign-off; a row signed off without items, with a JSON null for items or with an unconfirmed licence refused, with both accepted; the committed file refused the same way. Without the check it fails |
| `apps/web/e2e/knowledge-base.spec.ts` | 360 px and desktop: the version page lists the 19 instruments, each awaiting its items, with the summary line |
