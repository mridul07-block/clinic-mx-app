# AI blind test (AI-06)

## Sources

- **PRD section 6:** "a mid tier model chosen by a blind test on 30 to 50 anonymised Movementology
  cases, scored by clinicians"; "DeepSeek's own API is never used for patient data".
- **PRD client dependencies:** "Provide 30 to 50 anonymised past cases for the AI model test."
- **TAD section 7:**
  - the candidates: "Sonnet 5.5, GPT 6 Sol, Gemini 3.1 Pro; DeepSeek V4 Pro and GLM 5.3 via US
    or EU hosts with zero data retention";
  - "The blind test ... reruns whenever the model, prompt or knowledge base changes".
- **AI-06, ticket text:** "Runs 30 to 50 anonymised cases through candidate models; clinicians
  score blind; results compared".

## Status: partly done

The tool is built and tested on generated cases. A real run waits for three things:
- the client's anonymised cases;
- the OpenRouter key (`docs/runbooks/ai-gateway.md`);
- the candidates' OpenRouter model names and US or EU providers.

These are recommended defaults, chosen under the user's standing approval of 28 October 2026, and
recorded as DECISION AI-06 in `docs/PROGRESS.md`.

## What the operator does

The tool runs from the command line: `pnpm ai:blind-test` (`apps/web/scripts/blind-test.ts`,
`apps/web/modules/ai/blind-test.ts`).

- **Database:** it needs `DATABASE_URL`, pointing at the environment whose knowledge base version
  will go live.
- **Key:** it needs `OPENROUTER_API_KEY` for a real run.
- **The working folder:** everything is kept in the `--out` folder you give, outside the
  repository. `.blind-test/` is ignored by git if you keep it under the project. Only counts are
  printed.

### 1. The case file

JSON shaped as `{ "cases": [ ... ] }`. Each case holds:
- `ref`: `case-001`, never a patient's number.
- `case`: exactly the fields the model may be sent (`age`, `sex`, `region`, `symptoms`,
  `durationWeeks`, `sport`, `goal`).
- `onset`: `gradual`, `sudden` or null.
- `painZones`: body chart zone keys.
- `confirmed`: one to three knowledge base condition IDs, the diagnosis confirmed at review or
  discharge (PRD: the learning label).

The client supplies the cases. The operator maps the client's diagnosis names to condition IDs.

The file is refused when:
- the count is outside `ai.blind_test_cases_min` and `ai.blind_test_cases_max` (30 and 50);
- any text looks like an identifier (the AI gateway's guard);
- a confirmed ID is not in the version being tested.

### 2. The candidate file

`{ "candidates": [ { "id": "candidate-a", "config": { ... } } ] }`: two to five candidates. Each
`config` holds:
- an OpenRouter model;
- one to three pinned providers;
- the prompt version, reasoning effort, timeout and token limit.

`docs/examples/blind-test-candidates.example.json` shows the shape with made-up names. A provider
in `ai.blocked_providers` (DeepSeek) is refused.

### 3. Run

```
pnpm ai:blind-test run --cases <file> --candidates <file> --out <folder> [--kb-version <n>] [--dry-run]
```

Each case gets its shortlist (AI-02) and is ranked by each candidate, in an order that changes
from case to case. The ranking is validated as the sheet does it (AI-03).

- **The gateway:** every call goes through the AI gateway with the candidate's model for that call
  only. It keeps zero data retention, pinning and the identifier guard, and never changes the
  task's settings.
- **Logging:** every call is logged to `ai_run`, tagged with the run, outside any episode, and read
  by nobody signed in.
- **Budget:** calls count against `ai.blind_test_budget_paise` (₹2,000), never the daily cap.
  - At the budget the run stops. To finish it in the same folder, the budget has to be raised
    first; otherwise start a new folder.
  - Running again with the same folder resumes and skips what is done.
  - A changed case or candidate file, or a changed version, is refused.
- **Key:** a real run needs `OPENROUTER_API_KEY`. A candidate that cannot be called stops the
  run with nothing saved for it, so the next run tries it again.
- **`--dry-run`** calls no model and logs no runs, to check the files and the flow.
  - Use its own folder: a real run refuses a dry run's folder.
  - A dry run's report says so, and gives no reference for the gate.

### 4. Scoring sheets

```
pnpm ai:blind-test sheets --cases <file> --out <folder> --scorers <n>
```

This writes `scoring/scorer-<n>.csv`, one per clinician (two or more consultants named by the
client). Each row is one case and one label, A to E. The labels hide the models and are shuffled
case by case; each clinician also reads the cases in their own order. A row shows:
- the case;
- the confirmed diagnosis;
- that label's suggestions, in the knowledge base's names, with the model's reasons.

The clinician fills in:
- **usefulness**, 1 to 5;
- **unsafe or misleading**, yes or no;
- a note (no patient details).

`key.json` maps labels to models. Keep it from the scorers.

- **Adding scorers:** run `sheets` again with a higher `--scorers`. The key and the labels never
  change once issued.
- **The check column** ties each row to its case, its label's model and its scorer. Clinicians
  leave it alone, and save as "CSV UTF-8".

### 5. Compare

Put the returned sheets in `scoring/returned/`, then run:

```
pnpm ai:blind-test compare --cases <file> --out <folder>
```

Compare checks that the run is finished first. A returned sheet is refused if:
- a case or suggestion cell was changed;
- any case and label is missing or appears twice;
- a score is missing or out of range;
- it is a sheet already returned under another file name. `report.md` and `report.json` give, per candidate:
- top 1, top 3 and anywhere on the sheet;
- how often it was unavailable;
- latency p50 and p95;
- cost;
- the clinicians' mean usefulness;
- the cases marked unsafe.

They also give how often the confirmed diagnosis reached the shortlist at all. There is no pass
mark.

### 6. After the clinicians decide

1. Set the winner's model and providers in `ai.task_rank_diagnoses` and
   `ai.task_recheck_with_findings` by a forward migration that cites the report.
2. The Super Admin switches the AI preparation sheet on (AI-09), recording the blind test date and
   the report's reference line.
3. Run the blind test again whenever the model, prompt or knowledge base changes. A newer approved
   knowledge base version already switches the sheet off.

## Not yet

- Pinning the tested model and prompt in the AI gate (so a later change switches the sheet off).
  This comes with adopting the winner, once a key exists.
- The recheck (AI-04) in the test. Similar cases (AI-05) are in it: each case's are the file's
  other cases, never itself, and `report.json` holds each prompt version's hash
  (`docs/runbooks/ai-similar-cases.md`).
- Scoring in the app instead of sheets.
