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
recorded as DECISION AI-01 in `docs/PROGRESS.md`. No OpenRouter key exists yet.

- Everything is built and tested with a fake transport.
- Locally, in CI and on staging, each run is logged as `not_configured` and no model is called.
- **Live calls need two things:**
  - `OPENROUTER_API_KEY` in the environment (server only; `apps/web/lib/env.ts`, `.env.example`);
  - a model and pinned providers in the task settings, chosen by the blind test (AI-06,
    `docs/runbooks/ai-blind-test.md`).
- No clinical call ever goes to a provider in `ai.blocked_providers` (DeepSeek: PRD section 6).
- Even then, the AI preparation sheet runs only while the AI gate is on (AI-09,
  `docs/runbooks/ai-gate.md`).

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
   - Every request asks for `provider.zdr: true` and `data_collection: 'deny'`. A clinical task
     adds its pinned `order` with `allow_fallbacks: false`.
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
| `ai.task_rank_diagnoses`, `ai.task_recheck_with_findings` | model none, providers none, prompt v2 (since AI-05), reasoning low, 6000 ms, 800 tokens | Set the model and providers after the blind test (AI-06). Two attempts of 6 seconds stay inside the 15 second target. |
| `ai.daily_spend_cap_paise` | 20000 | DECISION AI-01: a placeholder for the client. |
| `ai.usd_rate_paise` | 9650 | Paise per US dollar, from TAD section 11. |

## Prompts

`prompts.ts` holds the fixed instructions by version. They say how to answer, never what is
clinically true. A prompt changes only as a new version, because a unit test pins each version's
text. A new prompt or model means a new blind test (TAD section 7).

Version 2 of both clinical prompts (AI-05) is told about the similar confirmed cases. The input
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
- `transport.test.ts`:
  - the OpenRouter request, cost and tokens;
  - errors read without their text;
  - prompts pinned.
- `packages/schemas/src/ai-gateway.test.ts`: the allow list, the output, the config, and the money
  arithmetic.
- `packages/db/src/integration/ai-runs.integration.test.ts`:
  - who reads, per role;
  - the server writes, audited and never changed;
  - the IST day's spend;
  - one open spend cap task.
  - Dropping the centre condition from the read policy fails this test.

## Open risks

- **Unverified until a key exists:** OpenRouter's acceptance of zero data retention and pinning.
  The field names follow OpenRouter's provider routing documentation as read on 28 October 2026.
- **Name check:** a name typed in free text is caught only if the caller passes the patient's name
  words (AI-03).
- **Unpriced runs:** a run whose provider reports no cost counts as nothing against the cap.
- **Timed out attempts:** a timed out attempt is still billed by the provider, but its cost is not
  known, so it does not count against the cap. Once a key exists, the generation's cost can be
  looked up afterwards.
