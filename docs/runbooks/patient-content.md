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

## Generation by AI (not yet)

The gateway task waits for:
- the `OPENROUTER_API_KEY`;
- the choice of the "best available" model;
- a one-time spend cap of its own: the $20 to $35 run cannot finish under the daily cap `ai.daily_spend_cap_paise` of ₹200.

Until then a consultant writes each draft. Once AI generation runs, its drafts are written by the system with source `ai`, and are approved the same way.

The prompt says how to write (lay terms, CLEAR, the four parts), never what is clinically true. Its input is the condition's own knowledge base rows, with no patient data.

## What the clinic supplies

- **The content:** about 12 to 18 clinician hours across 345 conditions (PRD client dependencies).
- **The approver:** who counts as an approving clinician.
- **Hand writing:** whether hand-written drafts may stand alongside AI ones. The ticket says "generated"; this default lets a consultant write each word until AI runs.
- **Warning signs:** the warning-sign wording for OUT-09.

## Tests

| File | Covers |
| --- | --- |
| `packages/schemas/src/patient-content.test.ts` | the four parts in the TAD's order; a draft trimmed, each part required and kept to 4000 characters; a condition's state |
| `packages/db/src/integration/patient-content.integration.test.ts` | a consultant's draft saved and changed on the revision read, approved, then superseded by another's, audited; a save or approval on an old revision refused, and a second first draft; approved text unchanged, its id kept, never removed or truncated even by the database owner; nobody else writes (a physio who does not consult, a desk login even with both ticks, Finance, support) or approves; a draft discarded; a draft on an older version not approved, nor saved without its condition in the live one; read by knowledge base readers, not the desk or Finance. Without the guard trigger it fails |
| `packages/db/src/integration/my-plan.integration.test.ts` (About your condition) | nothing while none is approved, never a draft or another condition's; the approved explanation for the signed diagnosis, then the confirmed one's instead. Without the approved-only filter it fails |
| `apps/web/e2e/explain.spec.ts` | 360 px and desktop: Explain to patient from the consultation, saying none is approved before and while there is only a draft (never showing it), then the approved content for the chosen condition; the patient's My plan with About your condition, the explanation alone |
| `apps/web/e2e/patient-content.spec.ts` | 360 px and desktop: the consultant finds a condition, is asked for each part, saves the draft ("Draft saved."), approves it; a physio who does not consult reads it with nothing to write |
