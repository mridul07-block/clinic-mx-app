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

The tool is built, and it has run live on cases generated from the knowledge base (below). The
real run, the one the clinicians score and the AI gate cites, waits for the client's 30 to 50
anonymised cases.

These are recommended defaults, chosen under the user's standing approval of 28 October 2026, and
recorded as DECISION AI-06 in `docs/PROGRESS.md`.

## First live run on generated cases (30 October 2026)

**What ran:**
- 30 cases built from knowledge base version 1, outside the repository. Each case is one
  listing's own age, sex, onset, activities and symptom words, labelled with that listing's
  condition: no patient and no invented clinical text. Bone Stress has no health form region, so
  it was left out; high risk rows were left out because they are always on the sheet.
- 3 candidates, the PRD's two test candidates and one premium model as a yardstick, each pinned to
  a zero data retention host, with reasoning off, prompt `rank_diagnoses.v2`, 800 tokens and
  12 seconds a call.

**What it showed** (`ok` is a valid ranking within the time; p50 and p95 are the time to an
answer, including a retry):

| Candidate | Pinned host | ok | p50 | p95 | Cost of a sheet |
| --- | --- | --- | --- | --- | --- |
| `z-ai/glm-5.3` | `wafer/us` | 28 of 30 | 4.9 s | 12.6 s | about $0.001 |
| `deepseek/deepseek-v4-pro-0813` | `sail-research/us` | 26 of 30 | 5.5 s | 18.1 s | about $0.001 |
| `openai/gpt-6.1-sol` | `azure/eu` | 14 of 30 | 10.8 s | 23.6 s | about $0.007 |

**What it means:**
- **Accuracy is not measured here.** A generated case repeats its row's own words, so every valid
  ranking put the labelled condition in the top 3. That needs the client's real cases and the
  clinicians' scores. This run is not a pass and gives no reference for the AI gate.
- **Reliability, speed and cost are measured,** and they separate the candidates. GLM 5.3 was the
  most reliable, the fastest and the cheapest. GPT 6.1 Sol was too slow for the sheet's 15 second
  target. Gemini 3.1 Pro was probed and left out: it reasons before every answer, even a one word
  one (278 tokens and 4.9 seconds), so it is the slowest and dearest per call.
- **Reasoning must be off** (`reasoningEffort: "none"`). With `low`, DeepSeek V4 Pro spent all
  800 tokens reasoning and its answers were cut off.
- **6 seconds a call is too short.** The task settings' placeholder of two calls of 6 seconds
  failed often for every candidate. The winner's timeout is set from its measured p50 and p95 when
  it is adopted.
- **Model names have moved on** since the TAD: GPT 6 Sol is now GPT 6.1 Sol, and DeepSeek V4 Pro's
  current build is `deepseek-v4-pro-0813`. The real run uses the names current on its day.

**Recommended for the real run** (DECISION AI-06, for the client to confirm): GLM 5.3 pinned to
`wafer/us` then `sail-research/us`, DeepSeek V4 Pro pinned to `sail-research/us`, both US hosts with
zero data retention, and GPT 6.1 Sol as the yardstick if the clinicians want one.
`docs/examples/blind-test-candidates.example.json` holds this file, with 12 seconds a call.

**What it cost:** the full run at 12 seconds cost $0.44, of which about $0.28 went on calls that
timed out, whose cost never comes back (`docs/runbooks/ai-gateway.md`, Open risks). With the
probes and a first attempt at 6 seconds, stopped part way, the development key spent $0.59 in
all. A real run of 50 cases
with these candidates costs about $0.50 to $0.75.

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

`docs/examples/blind-test-candidates.example.json` is the recommended file (above). A provider
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
