# AI gateway (AI-01)

## Sources

- **TAD section 7, "AI gateway":**
  - one function per task, with model, prompt version, reasoning effort, timeout and token limit
    in config;
  - `zdr: true` on every request;
  - a pinned provider for clinical tasks;
  - identifiers stripped;
  - JSON schema output, retried once, then "Suggestions unavailable";
  - every run logged to `ai_run`;
  - a daily spend cap with an alert to the Super Admin.
- **PRD section 6:** "Provider: OpenRouter, with zero data retention enforced on every request
  and pinned providers for clinical calls"; "No names, phone numbers or IDs are sent to any
  model"; "Every run logs model, knowledge base version, inputs, outputs and dispositions".

## Status: partly done

These are recommended defaults, chosen under the user's standing approval of 28 October 2026, and
recorded as DECISION AI-01 in `docs/PROGRESS.md`.

- Everything is built and tested with a fake transport.
- **Proven live on 30 October 2026** with a development key (`pnpm ai:check` and the blind test,
  `docs/runbooks/ai-blind-test.md`): OpenRouter takes `zdr`, `data_collection`, a pinned `order`
  of host tags such as `wafer/us`, `allow_fallbacks: false`, `require_parameters` and the strict
  schema, and reports each call's cost.
- **No model is set yet**, so locally, in CI and on staging each run is logged as `not_configured`
  and no model is called. Live calls need two things:
  - `OPENROUTER_API_KEY` in the environment (server only; `apps/web/lib/env.ts`, `.env.example`);
  - a model and pinned providers in the task settings, set when the winner of the blind test is
    adopted (AI-06).
- No clinical call ever goes to a provider in `ai.blocked_providers` (DeepSeek: PRD section 6),
  whether it is pinned by name (`deepseek`) or by a tag on it (`deepseek/fp8`).
- Even then, the AI preparation sheet runs only while the AI gate is on (AI-09,
  `docs/runbooks/ai-gate.md`).

## The live check (`pnpm ai:check`)

Run it after setting the key in an environment, and before and after adopting a model.

```
pnpm ai:check
pnpm ai:check --model z-ai/glm-5.3 --provider wafer/us --provider sail-research/us
```

- **The key:** what it has used, its credit limit and what is left. It warns when the key has no
  limit: that limit is the only hard stop (see Open risks).
- **Each task with a model in its settings,** or the one candidate named: one call with a fixed
  made-up case (`apps/web/modules/ai/gateway/check.ts`), built by the gateway's own
  `buildRequest`, so zero data retention, no data collection, pinning and the strict schema are
  the ones the sheet uses.
- **A named candidate** runs as the blind test measured it: reasoning off and 12 seconds, unless
  `--reasoning` or `--timeout-ms` says otherwise; its prompt and token limit are the ranking
  task's. With no model named and no task configured (staging and production until a model is
  adopted), nothing is called and it says so.
- **The outcome:** `ok`, `not_pinned` (a host outside the pinned list answered), `invalid_output`,
  `timed_out`, `failed` (with the HTTP status) or `blocked_provider` (never called); the host that
  answered, the time and the cost.
  - Whether a pinned host answered is read from the host's name in the answer ("Sail Research"
    for `sail-research/us`), letters and digits only. The region in a tag (`/us`) is not in the
    answer, so it is not checked here; OpenRouter itself never routes outside the pinned list.
- **Exit codes:** 0 when every check called is `ok` (or nothing was called); 2 when any is not;
  1 when it cannot check at all (no key, a refused key with its HTTP status, OpenRouter out of
  reach, or a wrong option, which prints the usage).
- No patient data and no knowledge base text is sent, and nothing is written: the check runs no
  task, so it is not an `ai_run`. A check costs a fraction of a cent.

## How a run goes (`apps/web/modules/ai/gateway`)

`index.ts` is the only surface to use. The clinical tasks `rankDiagnoses` and
`recheckWithFindings` take the AI gate's pass, so they run on the knowledge base version the gate
was switched on for. `run.ts` runs every task in this order:

1. **The input is checked against the task's allow list** (`packages/schemas/src/ai-gateway.ts`).
   - The case holds exactly the TAD's fields: age, sex, region, symptoms, duration, sport and goal.
   - Shortlist rows go out numbered, with the knowledge base's own words.
   - Anything else, such as a name or ID field, means `blocked`.
2. **Configuration.** With no key, no model, or a clinical task with no pinned providers, the run
   is `not_configured`.
3. **Every text value to be sent is scanned as written** (`guard.ts`; not as JSON, where a
   line break would join words) for:
   - UUIDs;
   - email addresses;
   - OP numbers and appointment IDs;
   - any run of 7 or more digits (phone numbers);
   - the patient's own name words, when the caller passes them.

   A hit means `blocked`, and nothing is sent.
4. **The daily spend cap.**
   - The IST day's charges are converted to paise at `ai.usd_rate_paise` (9650, from TAD
     section 11).
   - At or above `ai.daily_spend_cap_paise` (20000, which is ₹200), the run is `capped`.
   - The Super Admin gets one high priority task (`ai.spend_cap`), and only one open at a time.
   - The cap is soft: calls already running when the cap is reached may each go over by one call.
5. **At most two calls** to OpenRouter (`transport.ts`).
   - Every request asks for `provider.zdr: true` and `data_collection: 'deny'`. A clinical task,
     and patient content (AI-07; `pinnedAiTasks`), adds its pinned `order` with
     `allow_fallbacks: false`.
   - `response_format` is a strict JSON schema of the task's output, kept to shapes only (types,
     properties, required fields, no extra fields). Some strict providers refuse length and count
     bounds, so the bounds are checked on the answer instead.
   - An invalid answer, a timeout (`timeoutMs`), a network error or a provider error is retried
     once. After that the result is `invalid_output`, `timed_out` or `failed`.
   - No `user` field is sent.
6. **One `ai_run` row** is written whatever happened, by the server as `system:ai`. It records:
   - the model and the provider that answered;
   - the prompt version and the knowledge base version;
   - the sha256 of the input, and the de-identified input exactly as sent (`{}` when nothing was
     sent);
   - the output, only when it was valid;
   - the status, the attempts and the latency;
   - the cost in millionths of a dollar across both attempts, and the tokens.

Anything but `ok` returns `unavailable`. Nothing throws for the model, so the consultation never
waits on AI; the sheet shows "Suggestions unavailable right now. Continue the consultation as
usual." (AI-03).

## Settings

| Key | Default | Meaning |
| --- | --- | --- |
| `ai.task_rank_diagnoses`, `ai.task_recheck_with_findings` | model none, providers none, prompt v3 (since AI-03's live run: only the rows the sheet shows), reasoning none, 6000 ms, 800 tokens | Set the model and providers after the blind test (AI-06). Two attempts of 6 seconds stay inside the 15 second target. |
| `ai.daily_spend_cap_paise` | 20000 | DECISION AI-01: a placeholder for the client. |
| `ai.usd_rate_paise` | 9650 | Paise per US dollar, from TAD section 11. |
| `ai.task_write_patient_content` | model none, providers none, prompt `write_patient_content.v1`, reasoning none, 60000 ms (up to 120000 for this task only; the sheet's tasks keep 20000), 2500 tokens | Patient content (AI-07): the operator names the model and hosts for each run (`docs/runbooks/patient-content.md`). |
| `ai.patient_content_budget_paise` | 350000 | DECISION AI-07: the one-time patient content run's own budget, never the daily cap; a placeholder for the client. |
| `ai.patient_content_stop_after_failures` | 3 | The patient content run stops after this many calls in a row with no valid answer (a timed out call's cost never comes back). |

## Prompts

`prompts.ts` holds the fixed instructions by version. They say how to answer, never what is
clinically true. A prompt changes only as a new version, because a unit test pins each version's
text. A new prompt or model means a new blind test (TAD section 7).

Version 3 of both clinical prompts (AI-03's live run, 31 October 2026) is sent a `limit`, the
number of rows the sheet shows, and returns only that many; `runTask` sends it only to a prompt in
`aiPromptsWithLimit`. Version 2 of both clinical prompts (AI-05) is told about the similar confirmed
cases, as v3 is. The input
schemas allow `similar` (strict structured cases, at most 5), and `runTask` sends it only to a
prompt in `aiPromptsWithSimilarCases`; a v1 prompt never gets it
(`docs/runbooks/ai-similar-cases.md`).

## The `ai_run` table

- **Who reads it:** consultants (Consultant tick) read the runs of episodes at centres they see
  (TAD: "`ai_run` only with `consultant`"). Runs outside an episode are read by nobody signed in.
- **Who writes it:** only the server. Every row is audited, and none is ever changed or deleted
  (`internal.ai_run_append_only`).
- **Dispositions** (Keep and Dismiss) belong to `ai_suggestion` (AI-03).

## Adding a task

1. Add its input and output schemas to `packages/schemas/src/ai-gateway.ts`.
2. Add its prompt version, settings key and settings row.
3. Add it to `TASKS` in `run.ts`.
4. Add a function in `index.ts`.

## Tests

- `apps/web/modules/ai/gateway/run.test.ts`:
  - zero data retention, no data collection and pinning on every request;
  - the strict schema output;
  - one retry;
  - the spend cap;
  - not configured;
  - blocked identifiers;
  - the run logged;
  - numbered rows mapped back.
- `check.test.ts`: the live check's made-up case passes the allow list and the guard, goes out with
  zero data retention and pinning, and reports another host, a wrong answer, a timeout and a
  blocked provider (never called); the key's limit and use.
- `transport.test.ts`:
  - the OpenRouter request, cost and tokens;
  - errors read without their text;
  - prompts pinned.
- `packages/schemas/src/ai-gateway.test.ts`: the allow list, the output, the config, the money
  arithmetic, and a blocked provider by its name or a tag on it.
- `packages/db/src/integration/ai-runs.integration.test.ts`:
  - who reads, per role;
  - the server writes, audited and never changed;
  - the IST day's spend;
  - one open spend cap task.
  - Dropping the centre condition from the read policy fails this test.

## Open risks

- **Timed out attempts are billed, but their cost never comes back.** The request is abandoned, so
  OpenRouter's answer, which carries the cost, is never read; the daily cap cannot count it. In the
  first blind test's full run (30 October 2026, `docs/runbooks/ai-blind-test.md`) about $0.28 of
  the $0.44 it cost was on timed out calls. The key's
  own credit limit on OpenRouter is therefore the hard stop: give every environment's key a
  monthly limit, and choose timeouts from measured latency so that timeouts stay rare.
- **Latency varies with the hosts' load.** Measured on 30 October 2026, the time to an answer for
  the same model ran from 2 to 13 seconds within an hour. Two attempts of 6 seconds failed often for
  every candidate (`docs/runbooks/ai-blind-test.md`).
- **Name check:** a name typed in free text is caught only if the caller passes the patient's name
  words (AI-03).
- **Unpriced runs:** a run whose provider reports no cost counts as nothing against the cap.
