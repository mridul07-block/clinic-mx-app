# Knowledge base

SET-05, TAD section 4 ("Knowledge base tables"), PRD rule 4 ("clinical knowledge is versioned
data"). The nine Assessment and Management workbooks in `docs/Joint wise AI Training/` are
imported as a knowledge base version. Condition search (CLN-06), the diagnosis shortlist (AI-02)
and the version viewer with approval (SET-06) read it. Later tickets import the other sheets:
SET-07 exercises, SET-08 questionnaires, SET-09 programme phases and criteria (imported with OUT-04, `docs/runbooks/sessions.md` "Phase stepper"), SET-10 red flag
rules.

## Decisions (user, 22 October 2026)

- **Red flag tier, from the Red Flag Status wording:**
  - "No" → none;
  - "Screen: …" → screen;
  - "YES if/for …" → conditional;
  - any other "YES …" → red flag.

  The Bone Stress workbook has no such column: its rows are "not stated", and its Risk Class is
  kept separately. The text itself is always kept word for word.
- **Duplicates:**
  - **Merged:** a condition two workbooks name the same (brackets ignored) has one ID, and each
    workbook's row is kept as a listing with its own text. There are 9, for example Cervical
    Radiculopathy in Shoulder and Cervical.
  - **Look-alikes:** listed in the report for a clinician to confirm (client clean up, OPS-02),
    and merged only when the ID file says so.
- **Activity tags:** a fixed vocabulary (`activityTagVocabulary` in
  `packages/schemas/src/knowledge.ts`), matched by keywords. The report lists rows that matched
  no tag.
- **Version state:** an import is a new version, recorded as a draft. The Super Admin approves
  it (SET-06, below).

## Versions, the viewer and approval (SET-06)

Recommended defaults, chosen under the user's standing approval of 28 October 2026 (DECISION
SET-06 in `docs/PROGRESS.md`).

- **The live version** is what new clinical records take and store (consultations, session notes,
  red flag rules at the health form submit, phases and readiness criteria): the newest approved
  version. Before any version is approved, the newest import is live, so a fresh install works
  (bootstrap). Once one version is approved, a draft never goes live. The selectors share
  `liveVersionCondition` in `packages/db/src/knowledge.ts` (`latestKnowledgeVersion`,
  `latestPhaseVersion`, `latestCriteriaVersion`).
- **Records keep their version.** A consultation or session note stores the version it was opened
  with; approving a newer version never changes it (rule 4).
- **Where a version stands** is worked out, not stored (`knowledgeVersionStandingsOf` in
  `packages/schemas/src/knowledge-versions.ts`): Live; Superseded (approved, older than live);
  Draft, awaiting approval (newer than live); Passed over (a draft older than live, which can no
  longer be approved).
- **Approval:** only the Super Admin, not a Velyx support login, through
  `internal.approve_kb_version` (the only write a signed in person makes to `kb_version`). It
  refuses a version already approved, one not newer than the live version and an unknown one;
  records the approver from the sign in, the time and an optional note (up to 1000 characters);
  and is audited as the Super Admin. The form asks them to confirm they have read the import
  report. Red flag rules and modality links awaiting clinical sign-off are shown, not a gate.
- **Never changed:** the `kb_version_guard` trigger refuses any delete, any change to an approved
  version, and any change to a draft other than its approval. There is no un-approve: a draft
  that should not go live is passed over by approving a newer one.
- **The viewer:** `/app/knowledge-base` (Home, "Knowledge base") lists the versions for knowledge
  base readers (Super Admin, Centre Managers, physios). A version's page shows its source files
  with their SHA-256 and the import report in folded parts. The Super Admin (not support) also
  sees how many consultations and session notes stored it, drafts and every centre included
  (`internal.kb_version_usage`, counts only), and the approve form. The monthly improvement report is
  a placeholder until AI-08.
- **Tests:** `packages/db/src/integration/knowledge.integration.test.ts` ("knowledge base
  approval"), `apps/web/modules/knowledge-base/services.test.ts`,
  `packages/schemas/src/knowledge-versions.test.ts` and `apps/web/e2e/knowledge-base.spec.ts`. The
  end to end test approves CI's only version and puts it back to a draft afterwards
  (`apps/web/e2e/knowledge-base.ts`, test harness only).

## What is stored

| Table | One row per | Holds |
| --- | --- | --- |
| `kb_version` | import | number, draft or approved, the workbooks' and the red flag rules file's names and SHA-256, the import report (JSON), who made it (`system:kb-import`) |
| `kb_condition` | condition per version | stable ID (`SHO-001`), name, synonyms (from the names' brackets), home workbook |
| `kb_condition_listing` | workbook row per version | the region (workbook) and row; the subregion (Region column); age, onset, sex, activity tags and red flag tier as read, each beside its text; the discriminating question, tests and imaging, symptoms and biomechanical cause; every other column word for word in `details` |
| `kb_red_flag_rule` | rule per version (SET-10) | the rules the health form submit runs, from `packages/db/src/knowledge/red-flag-rules.json` (`docs/runbooks/red-flags.md`) |
| `kb_red_flag_presentation` | Red Flags sheet row per version (SET-10) | each workbook's red flag presentations (features, action, why it cannot wait) and its screening notes, word for word |
| `kb_measure` | Progress Tracker measure per version (CLN-05) | key (`knee.lsi.quadriceps`), section title, name and unit word for word, kind, how its formula reads it (rule), direction, note |
| `kb_special_test` | Special Tests row per version (CLN-05) | key, category, test, targets, positive finding, clinical note, word for word |

A version is never edited in place. Clinical records will store the version they used, so a later
version never changes what a past record meant.

## How each column is read

| Column | Read as | Unreadable |
| --- | --- | --- |
| Age | Min and max years. "20-50"; "50+" (no max); "Under 45" (up to 44); "Any …" (any). Alternatives ("20-40 (athletes) / 70+") become the range covering both, and "… also young …" becomes any age, so the shortlist never leaves a condition out on age. | Stops the import |
| Onset | `sudden`, `gradual` (Slow), `recurrent`, `subacute`; "A/B" gives both; words after "after" are kept in the text | Stops the import |
| Predominance | `male`, `female` or `equal`; "… athletes" also adds the athlete tag | Stops the import |
| Red Flag Status | The tier above | Stops the import |
| Activity Level | Tags from the vocabulary (Bone Stress: Sport & Load Pattern and Athlete Profile) | No tag; listed in the report |
| Region | The subregion, spelled one way ("Pediatric" reads as "Paediatric"; Bone Stress: Tissue) | Not applicable |

Each workbook names its columns its own way. `packages/db/src/knowledge/columns.ts` maps every
header to one key, and an unknown header stops the import, so a renamed column is never silently
dropped.

## Measures and special tests (CLN-05)

The consultation's Objective records each region's measures and adds its special tests, both from
the workbooks (user decisions 24 October 2026). `packages/db/src/knowledge/objective.ts` reads them.

**Progress Tracker.** Each section is a title row, then a header row, then its rows. The header
and each row's formulas decide the kind:

| Header | Formulas | Kind |
| --- | --- | --- |
| Involved, Uninvolved | `B/C` (`C/B` for a timed test, "lower time is better"); PASS at the target (the sheet's "LSI target threshold (editable)" or a figure; the heel raise also needs a count) | LSI |
| Involved, Uninvolved | `C-B` or `ABS(C-B)`; SYMMETRICAL, MILD DEFICIT or RESTRICTED at the row's two bands | Deficit |
| Measured, Normal ref | `C-B`; FULL, MILD DEFICIT or RESTRICTED | Reference (deficit from the normal) |
| Achieved or Measured, Target | PASS when at least (or at most) the target | Reference (target) |
| Baseline, Current | none needed | Marker, with its direction; a "(0-3)" row with unit "grade" is a 0 to 3 rating |

- **Not measures:** sections without such a header (yes or no screens, ratios, readiness
  summaries) and rows without a unit, with a computed value, or with no formula beside two values
  (worded checks). The report lists them.
- **Stops the import:** a header or a formula that matches none of these. Nothing is guessed.
- **Keys:** `<region>.<kind>.<name>`. A clash takes its section, and one that remains stops the
  import.

**Special Tests.** The header is "Category | Test | Targets (Knee: Target Structure) | Positive
Finding | Clinical Note". A row without a category keeps the one above. Keys are
`<region>.<test>`; a clash takes the category. The Bone Stress workbook has no such sheet.

**What a new sheet means for versions.** A version's source now records the sheets read
(`sheets`). An import that reads more sheets from the same files is a new version (the first one
after CLN-05), and the same files and sheets twice is refused as before.

## Readiness criteria (OUT-08)

Each Progress Tracker's readiness section (its title holds "READINESS"; it ends at the "OVERALL"
row) gives the region's criteria, `kb_readiness_criterion`, in the workbook's order:

- a count line (`COUNT` or `COUNTIF` over a range): each measure row it names is a criterion,
  judged by the measure's rule, or for a "Baseline | Current" row by its status formula's target
  (`C >= F`) or MCID (`B - C >= F` lower is better, `C - B >= F` higher); a count over yes or no
  screen rows is one criterion, Met when none is positive;
- a yes or no line is a criterion the consultant marks;
- the threshold line is skipped (each measure's rule holds it);
- yes or no rows outside the section that the overall verdict needs (`COUNTIF(Bx:By,"YES")=n`
  over all of them, or `Bn<>"YES"`) are criteria too, after the section's.

A line or status formula that matches none of these stops the import. Reading this section was
added to the import as "Progress Tracker (readiness)", so the first `--apply` after it records a new
version.

## Diagnosis categories (CLN-06)

The client's "Physiotherapeutic diagnosis" list (in `docs/1 Movementology Clinical Management
Softwear (1).docx`) is committed word for word as
`packages/db/src/knowledge/diagnosis-categories.json`: 44 categories, each with a stable code made
from its name once (`knee_pfps` for "Knee - PFPS"; the client's spelling is kept in the name).
`conditions` maps condition IDs to codes and is empty until the client's mapping arrives (SET-12).

- The import checks the file (`categories.ts`): codes unique and lowercase, every mapped ID a
  condition in the workbooks, every mapped code a category. Any problem stops the import.
- Each version stores the categories (`kb_diagnosis_category`) and each condition's mapped code
  (`kb_condition.category_code`, a foreign key to the version's categories).
- The file's SHA-256 is part of the version's source, so editing it (SET-12's mapping, a renamed
  category) makes a new version, as the rules file does. Never change a code once used: signed
  diagnoses store it.

## Plan catalog (CLN-07)

`packages/db/src/knowledge/plan-catalog.json` holds what the consultation's Plan offers:

- **Modalities:** the Blueprint's six Part B modalities and the software document's Dry needling
  and Zero Gravity Treadmill. Keys follow the price master where one exists (`radial_shockwave`).
  Each lists the Health check precautions it warns about, with the source of each link, and
  `signedOff: false` until the client's clinical lead signs the links off (DECISION CLN-07).
  Each also lists the `parameters` a session note records for it (SES-05). Each parameter has a
  key, a label, a kind (`text` or `number`), an optional unit and its source.
  - Every modality has Area treated, Duration (min) and Settings, awaiting the clinic's own lists
    (DECISION SES-05).
  - Radial and Focused Shockwave add Energy flux density (mJ/mm²) and Frequency (Hz), from
    Consultation SOP v2 §12.3.
- **Questionnaires:** Blueprint Module 8's outcome measure library word for word (19 instruments),
  each with the workbooks it is for (Elbow / wrist–hand is Elbow and Forearm and wrist; PSFS is for
  any region) and its "Use for". Items and scoring arrive with SET-08.

The import checks it (`plan-catalog.ts`): known precaution keys and regions, no repeated keys,
links or parameters; any problem stops the import. Adding the parameters made version 2: notes
written before it keep version 1, whose modalities have none. Each version stores `kb_modality` and `kb_questionnaire`. The
file's SHA-256 is part of the version's source, so changing a link or signing one off makes a new
version. Never change a key once used: plans store it.

## Condition IDs

`packages/db/src/knowledge/condition-ids.json` maps `region|name as written` to an ID. The prefix
is the first workbook that named the condition (SHO, ELB, WRI, HIP, KNE, ANK, CER, LUM, BSC),
followed by three digits. An ID is never reused. Diagnoses and AI suggestions refer to these IDs,
so they must survive workbook edits:

- **A renamed row** stops the import ("has no condition ID"). Give the new name the old ID in the
  file by hand (change the key, keep the ID), then run again.
- **A new row:** run `pnpm kb:import --assign`. It gets the next ID of its workbook, or joins a
  condition another workbook names the same. Commit the changed file.
- **A merge** (a look-alike confirmed by a clinician): give both keys the same ID, keeping the
  older one.
- **A removed row:** its key stays in the file, and the report lists it under "matched no row".
  Delete the key only when no record uses the ID.

## Running it

```sh
pnpm kb:import            # read and check; writes docs/knowledge-base/import-report.md
pnpm kb:import --assign   # also give new rows IDs (commit condition-ids.json)
pnpm kb:import --apply    # also record the next version, a draft, at DIRECT_DATABASE_URL
```

- **Dry run and `--assign`:** need no database.
- **`--apply`:**
  - writes in one transaction, audited as `system:kb-import`;
  - refuses ("already imported as version N") when the latest version came from the same files,
    so running it twice does nothing;
  - prints counts only.
- **Staging or production:** run from `packages/db` with that environment's `DIRECT_DATABASE_URL`
  (the session pooler, see `docs/runbooks/environments.md`) after its migrations have run.

The committed report must match what the import writes; a unit test compares them. After changing
a workbook, the vocabulary or the ID file, run `pnpm kb:import` and commit the report with the
change.

## The report

`docs/knowledge-base/import-report.md`, also stored on the version for SET-06's viewer. It is for
the client's clean up and the Super Admin's approval:

- workbooks with their row counts and hashes (two sheet titles state a different count from the
  rows: Cervical says 38 and has 41, Bone Stress says 41 and has 39);
- gaps (no thoracic spine workbook);
- merged conditions, and look-alikes to confirm;
- identical long text under different conditions (possible copied text, OPS-02);
- red flag tier counts, conditional red flags, and Bone Stress risk classes;
- ages read as more than a plain range, and onsets with a note;
- tag counts and untagged rows;
- synonyms, the columns read, and IDs that matched no row.
