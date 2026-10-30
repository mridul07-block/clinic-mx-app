# Patient content

AI-07: "Patient content generation and approval: content generated once per condition; clinician approves before patients see it". Sources:
- PRD J3.8: "clinician approved content for the diagnosis".
- PRD M6, M13: "diagnosis in plain words".
- TAD section 4 `kb_patient_content`: "condition ID, explanation, roadmap, home advice, warning signs, approved_by".
- TAD section 7: "One time patient content | Best available, once | Reviewed and approved by clinicians before use".
- SOP section 11, the CLEAR framework.

Every choice below is a recommended default chosen under the user's standing approval, 29 October 2026 (DECISION AI-07), for the client to confirm.

Patients see it with CLN-08 ("Explain to patient") and My plan.

## What is kept

`kb_patient_content` holds one row per text of a condition.

**What each row holds:**
- the condition's stable ID, for example ANK-001, so content outlives knowledge base versions;
- the version it was written against;
- the TAD's four parts: Explanation, Roadmap, Home advice, Warning signs, each 1 to 4000 characters;
- the source: clinician, or AI once generation runs;
- a status: draft, approved or superseded;
- who wrote it, and who approved it and when;
- its revision, counting saves of the draft.

**Rules on rows:**
- A condition has at most one draft and one approved text at a time (`kb_patient_content_one_draft`, `kb_patient_content_one_approved`).
- An approved text never changes, keeps its id, and is never removed or truncated, even by the database owner. The only change allowed is to superseded, when a newer draft is approved (`internal.patient_content_guard`, `patient_content_no_truncate`).
- A draft is written and saved only against the live knowledge base version (`internal.live_kb_version`), for a condition in it.
- A draft written against a version no longer live is not approved until it is saved again, which brings it up to date. Its page says so.

## Who does what

**Reading:** everyone who reads the knowledge base reads it (the Super Admin, Centre Managers and physiotherapists; `jwt_views_knowledge`). The desk and Finance do not.

**Writing and approving:** a consultant who treats patients (`patient_content.approve`; the consultant and Treats patients ticks, active, in a role that reads the knowledge base; never a Velyx support login).
- They write or edit a condition's draft and save it. Each save names the draft and revision read: one saved by someone else in between is not overwritten, and two first drafts at once are refused. The second person is told to reload, and what they typed stays in the form.
- They discard it.
- They approve it through `internal.approve_patient_content`: the draft becomes what patients see, and the condition's approved text before it becomes superseded.
- Approving names the draft and revision read, checked under a lock in the database. A draft saved meanwhile is refused with "The draft has changed since you opened it. Reload the page to read it.
- The ticket says "clinician approves". Who counts as the approving clinician is for the client to confirm.

**Every write is audited.**

## Where

**Knowledge base, Patient content** (`/app/knowledge-base/patient-content`):
- each condition of the live version, by name;
- its state: No content yet, Draft awaiting approval, Approved, or Approved with a new draft awaiting approval;
- a search by name or ID;
- the filters All, No content, Drafts and Approved.

**A condition's page** (`/app/knowledge-base/patient-content/<ID>`):
- What patients see: the approved text, who approved it and when.
- The draft:
  - Consultants who treat patients get the four parts as text areas with what each holds. A new draft over approved content starts from the approved text.
  - They also get Save draft, Approve for patients and Discard draft.
  - Everyone else reads the draft.

## What patients see (CLN-08)

CLN-08: "Explain to patient view: clinician approved content for the chosen condition, readable by the patient". Sources:
- PRD J3.8;
- PRD M13: "diagnosis in plain words";
- Frontend Specification, Consultation: "Explain to patient".

Recommended defaults chosen under the user's standing approval, 29 October 2026 (DECISION CLN-08).

**Explain to patient** (`/app/consultations/<id>/explain`, linked from the consultation's heading):
- For whoever opens the consultation.
- Shows the condition chosen in the Assessment step: its name and the four approved parts, in large type, to show the patient on the clinician's screen.
- Before a diagnosis is chosen, it says to choose it first.
- With none approved, it says so, and offers a consultant who treats patients the link to write it.
- Never a draft.
- It shows the condition as last saved: the consultation saves itself within a second of a change.
- It shows the condition of this consultation. My plan follows the episode's confirmed diagnosis when a review confirms another.

**My plan:** "About your condition" shows the approved explanation alone for the episode's diagnosis: the confirmed one (AI-05), else the newest signed one. It is not shown while none is approved (`docs/runbooks/my-plan.md`). A provisional diagnosis's explanation is shown like any other; the content is about the condition, not the patient. That is a default for the client to confirm.

## Generation by AI

Built on 30 October 2026, as recommended defaults chosen under the user's standing approval
(DECISION AI-07), for the client to confirm. TAD section 7: "One time patient content | Best
available, once | Reviewed and approved by clinicians before use".

**Who runs it:** an operator, once, from the command line, with the model and its pinned hosts
named for the run (`apps/web/scripts/patient-content.ts`,
`apps/web/modules/ai/patient-content-generation.ts`):

```
pnpm ai:patient-content --model <vendor/model> --provider <host> [--provider <host>] [--condition <ID> ...] [--limit <n>] [--dry-run]
```

- It needs `DATABASE_URL` for the environment and `OPENROUTER_API_KEY`.
- **Which conditions:** every condition of the live knowledge base version with neither a draft nor
  approved content, or only the `--condition` IDs named (refused if one has content already), at
  most `--limit` calls.
- **What is sent** (`packages/schemas/src/ai-patient-content.ts`): the condition's name, its
  workbook's region and its other names; its listing's own text for symptoms, cause, red flags,
  timeline, management emphasis, loading stage, corrections and referral trigger (each cut at a
  word to 2,000 characters); and its region's programme phases (name, timing, goal). Never the
  condition ID and never anything about a patient.
- **The prompt** (`write_patient_content.v1`, pinned by a test) says how to write, never what is
  true: plain words, "you", at most 150 words a part, the SOP's CLEAR style (section 11.1), each
  part only from its own sources, nothing added that the input does not say, clinicians' options
  left out, no outcome promised, and "the physiotherapist will set" a timeline the input does not
  give. Each part's sources:
  - Explanation: the name, symptoms and cause.
  - Roadmap: the phases, timeline and loading stage.
  - Home advice: the corrections, management emphasis and loading stage.
  - Warning signs: the red flags and referral trigger.
- **A part with no source** says only "Your physiotherapist will go through this with you."
  (`PATIENT_CONTENT_HANDOFF`), set by the code whatever the model wrote, so no safety advice is
  ever made up. In knowledge base version 1 every condition has text for each part.
- **What comes back:** the four parts, each 1 to 4,000 characters. A valid answer becomes a draft
  written by the server (`system:ai`): source `ai`, no writer, revision 1, audited, against the
  version its text was read from. If that version stops being live during the run, the draft is
  saved again before it can be approved, as any draft is. A condition that gained a draft meanwhile is skipped, never overwritten.
- **Through the gateway:** zero data retention, no data collection, the pinned hosts with no
  fallbacks, never a blocked provider (`pinnedAiTasks`), the identifier guard, one retry, and one
  `ai_run` per condition (`write_patient_content`, outside any episode, with its knowledge base
  version; the database refuses it otherwise).
- **Its own budget:** `ai.patient_content_budget_paise` (₹3,500, a placeholder for the client)
  counts every run of the task, ever. It never counts against the daily cap and never stops the live
  sheet. At the budget the run stops; running again carries on with the conditions still without
  content.
- **A failing host:** a timed out call is billed, but its cost never comes back, so the budget
  cannot see it. The run also stops after `ai.patient_content_stop_after_failures` (3) calls in a
  row with no valid answer; check the host with `pnpm ai:check` and run again.
- **Settings:** `ai.task_write_patient_content` holds the prompt version, reasoning (none), the
  timeout (60 seconds; up to 2 minutes for this task only, the live sheet's tasks keep 20 seconds)
  and the token limit (2,500). The model and hosts are the operator's, for the
  run. A new prompt changes with a release.
- **`--dry-run`** builds and checks every input and calls nothing.
- Only counts are printed, with the run's cost as the gateway recorded it.

**First trial (30 October 2026, development key, local database only):** a dry run found all 345
conditions ready to send. Then three conditions each, on hosts with zero data retention:

| Model | Host | Drafts | Time a condition | Cost a condition | All 345, about |
| --- | --- | --- | --- | --- | --- |
| `openai/gpt-6.1-sol` | `azure/eu` | 3 of 3 | 17 to 23 s | $0.011 | $3.90 |
| `z-ai/glm-5.3` | `wafer/us` | 3 of 3 | 4 to 9 s | $0.001 | $0.30 |

- Both kept to the knowledge base's facts and used none of the fear words.
- GPT 6.1 Sol wrote clearly better drafts. For the quadriceps tendon tear (KNE-005), it sent the
  patient for urgent surgical assessment first, and said the exercise roadmap applies only after
  repair, with the workbook's own timeline and risk factors.
- GLM 5.3 was clear but rougher: for the shoulder (SHO-001) it put "Avoid routine surgery", a
  management note, under home advice.
- **After the review** the prompt names each part's sources and leaves out clinicians' options.
  Run again on GPT 6.1 Sol for KNE-005, ANK-001, LUM-002 and SHO-001: 4 of 4, 17 to 26 s and about
  $0.011 a condition ($0.045 in all). The shoulder's home advice no longer mentions surgery, and its
  numbers (sets, repetitions, a 5/10 pain limit, settling within 24 hours) are all in the
  condition's own row. Where the row gives no urgent care signs, the draft says the physiotherapist
  will go through them.
- **Recommended for the full run** (DECISION AI-07, for the client to confirm): GPT 6.1 Sol on
  `azure/eu`, about $4 for all 345, within the ₹3,500 placeholder budget. It is the "best
  available" of the models with a zero retention host that can return the four parts in a strict
  schema. Clinicians review every draft either way.

**After the run:** each draft shows "Written by AI" on the condition's page, and "Written by AI,
edited by" the consultant once someone saves it. A consultant who treats patients reads, edits and
approves each one, exactly as a hand-written draft. Nothing reaches a patient before that.

## What the clinic supplies

- **The content:** about 12 to 18 clinician hours across 345 conditions (PRD client dependencies).
- **The approver:** who counts as an approving clinician.
- **Hand writing:** whether hand-written drafts may stand alongside AI ones. The ticket says "generated"; this default lets a consultant write any condition by hand, and the AI run skips it.
- **The model and the budget for the full run:** which model writes the drafts, and how much the run may spend (`ai.patient_content_budget_paise`).
- **Warning signs:** the warning-sign wording for OUT-09.

## Tests

| File | Covers |
| --- | --- |
| `packages/schemas/src/patient-content.test.ts` | the four parts in the TAD's order; a draft trimmed, each part required and kept to 4000 characters; a condition's state |
| `packages/db/src/integration/patient-content.integration.test.ts` | a consultant's draft saved and changed on the revision read, approved, then superseded by another's, audited; a save or approval on an old revision refused, and a second first draft; approved text unchanged, its id kept, never removed or truncated even by the database owner; nobody else writes (a physio who does not consult, a desk login even with both ticks, Finance, support) or approves; a draft discarded; a draft on an older version not approved, nor saved without its condition in the live one; read by knowledge base readers, not the desk or Finance. Without the guard trigger it fails |
| `packages/db/src/integration/my-plan.integration.test.ts` (About your condition) | nothing while none is approved, never a draft or another condition's; the approved explanation for the signed diagnosis, then the confirmed one's instead. Without the approved-only filter it fails |
| `apps/web/e2e/explain.spec.ts` | 360 px and desktop: Explain to patient from the consultation, saying none is approved before and while there is only a draft (never showing it), then the approved content for the chosen condition; the patient's My plan with About your condition, the explanation alone |
| `apps/web/e2e/patient-content.spec.ts` | 360 px and desktop: the consultant finds a condition, is asked for each part, saves the draft ("Draft saved."), approves it; a physio who does not consult reads it with nothing to write. An AI draft shows "Written by AI", not shown to patients; the consultant edits it ("Written by AI, edited by") and approves it |
| `packages/schemas/src/ai-patient-content.test.ts` | the input holds the condition's own words and its region's phases, never its ID, strict; long text cut at a word; the parts with no source named; the four parts back, each written and within 4000 characters |
| `apps/web/modules/ai/patient-content-generation.test.ts` | a draft per condition without content, as the server, against the run's version, with the hand-off line in each part without a source; only the conditions and limit asked for, one with content refused; a draft started meanwhile never overwritten, a failed call leaves no content; failed calls in a row stop it; the budget stops it; a dry run, a blocked host, no host, no knowledge base and no key call nothing |
| `apps/web/modules/ai/gateway/run.test.ts` (writing patient content) | zero data retention and the named hosts pinned, logged outside any episode; its own budget, never the daily cap or the Super Admin's task; a wrong answer refused; never a blocked or unpinned host; a model named for the run only for this task |
| `packages/db/src/integration/patient-content-generation.integration.test.ts` | only conditions with neither a draft nor approved content are listed, with their own text; an AI draft is the server's (source ai, no writer, revision 1) and never replaces a consultant's; each region's phases; its spend counted apart from the daily cap; a run without a knowledge base version refused. Without the "no content yet" filter it fails |
