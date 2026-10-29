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

## Patients filling them (OUT-02)

OUT-02: "Patient filled questionnaires: opened by QR on the patient's phone; one question per screen; auto scored; raw answers and version stored". Sources:
- PRD J5.3;
- PRD J5.8: "questionnaire lines with a meaningful change band";
- the Frontend Specification;
- TAD `questionnaire_result`.

Every choice below is a recommended default chosen under the user's standing approval, 29 October 2026 (DECISION OUT-02).

**What can be filled:**
- The questionnaires the episode's plan names (`plan_of_care.questionnaires`), in the plan's order.
- Only those that can be filled in the live knowledge base version: the newest approved one, or the newest import before any approval. "Can be filled" means items, a confirmed licence and sign-off.
- Only for an open episode: Plan proposed, Active, On hold or Under review.

The database works this out (`internal.questionnaires_for`).

**The QR:** until WhatsApp sends them (WA-06), the plan and payment sheet has a **Questionnaires** section for those who check patients in at the episode's centre.
- When the plan names questionnaires, it offers "Show questionnaires QR", or says none can be filled yet.
- It shows the working link again, or issues a new single-use one (`links.questionnaire_days`, 7 days).
- The same link serves baseline, reviews and the end of care. The desk shows it whenever the clinician asks.
- Discharge scores are filled before discharge is recorded: a discharged episode takes no questionnaire.
- A link with everything filled is never shown again, even before the patient's page closes it (`internal.questionnaires_done`).

**On the phone** (`/p/<token>`):
- Each questionnaire in turn ("Questionnaire 1 of 2") opens with its instructions.
- Each item is on its own screen ("Question 3 of 12"):
  - worded answers are 64 px buttons;
  - scales are numbered buttons with their worded ends;
  - an activity takes its name, then a rating; a rating without a name counts as missing.
- The patient may go back, or skip an item. A skipped item counts as missing under the instrument's rule.
- Send posts every answer at once, with the knowledge base version and instrument version the patient was shown. If either changed meanwhile, nothing is kept and the page shows the current one.
- Once every questionnaire on the link is filled, the send closes the link and the page thanks the patient. A link left filled but open (two sends at once, or the plan or knowledge base changed) is closed when its page next opens.

**Scoring and what is kept:**
- Our server scores each questionnaire with `scoreQuestionnaire`. The patient's phone never sends a score.
- A `questionnaire_result` row keeps:
  - the raw answers (each value, null when skipped, and an activity's name);
  - the score, or none when too many items are unanswered;
  - how many items were answered and missing;
  - the knowledge base version and the instrument's own version.
- The row is written by the patient through the link, once per questionnaire per link. `internal.questionnaires_due` and the insert policy refuse anything not due, another version, another episode or a stopped link.
- The row is audited as the patient and never changed. Clinicians read it as they read signed records (`jwt_clinical_reader`). The desk, Finance and anyone signed in writing one are refused.

**The Progress tab:** each questionnaire filled in the current episode is a line over its own range. It has the shaded meaningful change band from the baseline, the better way, and a sentence such as "12 points better than the baseline; the meaningful change is 10 points, reached." A table lists each date, score and the items answered.

Each line is drawn with its newest result's definition. Results from an earlier instrument version share the line. The panels are in name order.

**Not yet:** these join when the clinic's instruments are in use:
- the discharge report's scores (OUT-11);
- the outcomes dashboards (DSH-03, DSH-06);
- the meaningful change KPI.

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
| `packages/schemas/src/questionnaires.test.ts` (OUT-02) | what is kept from a posted questionnaire (null for a skipped or disallowed answer, an activity's name); the Progress line's band both ways and its sentence |
| `apps/web/modules/questionnaires/services.test.ts` | the QR shown again or issued only while one can be filled, for those who check in at the centre; the next questionnaire and its place, and a filled link closed when its page opens; the raw answers and our score kept, none past the missing limit, the link completed once everything is filled; nothing for one not due, another version, a bad post or another link |
| `packages/db/src/integration/questionnaire-results.integration.test.ts` | the plan's signed off questionnaires due in its order, each once, both versions kept, the link completed only after the last, audited as the patient; refused for one awaiting items, another version or centre, a stopped link, a discharged episode, and staff writing; the desk at the centre sees what can be filled and issues a link only then, and is never shown a link with everything filled; read by clinicians, not the desk or Finance. Without the insert policy's due check it fails |
| `apps/web/e2e/questionnaires.spec.ts` | 360 px and desktop: the desk's QR, the instructions, one question per screen, an answer skipped, sent, scored 64.3 with the raw answers and version kept, and the physio's Progress line with its band |
| `apps/web/e2e/knowledge-base.spec.ts` | 360 px and desktop: the version page lists the 19 instruments, each awaiting its items, with the summary line |
