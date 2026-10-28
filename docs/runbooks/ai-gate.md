# AI on and off gate (AI-09)

The rule comes from three places:

- **PRD decision 23:** "Regulatory check on diagnosis suggestion software in India", owned by the
  client's lawyer, "before AI goes live".
- **PRD section 3, phase 5:** "AI preparation sheet and recheck, switched on only after the blind
  test passes".
- **TAD:** "legal check before the AI gate", and "the rest of the system launches regardless".

The ticket (AI-09) says: "AI sheet switched on only after the blind test passes and the legal check
clears".

## Decisions

These are recommended defaults, chosen under the user's standing approval of 28 October 2026.
They are recorded as DECISION 23 in `docs/PROGRESS.md`, and the client's lawyer confirms the scope.

- **One switch:** the setting `ai.preparation_sheet`, global and off by default
  (`supabase/migrations/20261028135100_ai_gate_rules.sql`).
  - Its value is either `{"on": false}`, or "on" together with the blind test pass and the legal
    clearance. Each of those is a date plus a reference (a document name or number, with no patient
    details).
  - It also stores when it was switched on, and the knowledge base version it was switched on for.
  - No pass mark is invented: whether the blind test passed is the clinicians' call (AI-06), and
    whether the legal check cleared is the lawyer's.
- **Who:** the Super Admin, at `/app/ai-preparation-sheet` (Home → "AI preparation sheet",
  permission `settings.manage`). A Velyx support login reads the page only.
  - **Off:** any time, with nothing to record.
  - **On:** only with both records, and only once a knowledge base has been imported.
  - The settings row's trigger audits every switch, with the value before and after.
- **Enforced twice:**
  - **In code:** the service, using `aiSheetSwitchSchema` in `packages/schemas/src/ai.ts`. It
    refuses dates in the future.
  - **In the database:** the check `setting_ai_sheet_evidence` refuses any "on" value that lacks
    both records and the knowledge base version, even from the owner.
- **Re-gated by the knowledge base:** the gate counts as on only while the version it was switched
  on for is still the live version (SET-06, `docs/runbooks/knowledge-base.md`).
  - Approving a newer version switches the sheet off until a new blind test is recorded. The TAD
    says the blind test reruns whenever the knowledge base changes.
  - AI-01 adds the model and prompt to the same comparison.
- **Read fresh, fails closed:** `aiSheetGate` (`packages/db/src/ai-gate.ts`) reads the row each
  time, not the 60 second settings cache, so switching off takes effect everywhere at once. A
  missing or unreadable value counts as off. The pure logic is `aiSheetGateState`.
- **What it covers:** suggesting diagnoses, which means the preparation sheet (AI-02, AI-03), the
  recheck (AI-04) and similar cases (AI-05).
  - It does not cover the blind test harness (AI-06), which must run before go live.
  - It does not cover patient content (AI-07), which a clinician approves before patients see it.
  - It does not cover the monthly report (AI-08).
- **While off:**
  - The health form submit still queues `ai.preparation_sheet`. Its job checks the gate and does
    nothing (`apps/web/modules/ai/preparation-sheet.ts`). No sheet is made later for forms
    submitted while the gate was off.
  - Clinicians see nothing about AI: consultations work as usual.
  - "Suggestions unavailable right now" (Frontend Specification) is only for a failure while the
    gate is on.

## For AI-01 to AI-05

Every AI step that suggests a diagnosis takes an `AiSheetPass` (`apps/web/modules/ai/gate.ts`).
Only `aiSheetPass(db)` makes one, and only while the gate is on, so these steps cannot be called
while it is off.

- Check the gate at the moment of use: in the job, and on the screen before showing a sheet or
  "Preparation sheet ready". Never cache the result.
- Build the sheet from the pass's knowledge base version.

## Tests

- `packages/schemas/src/ai.test.ts`: the switch's input, the stored value, and the gate's states,
  failing closed.
- `apps/web/modules/ai/switch.test.ts`: who may switch it; on requires both records and a
  knowledge base.
- `apps/web/modules/ai/preparation-sheet.test.ts`: the job does nothing while the gate is off.
- `packages/db/src/integration/ai-gate.integration.test.ts`:
  - it starts off;
  - the Super Admin switches it on, audited;
  - a newer live version switches it off;
  - no other role can switch it, and support is read only;
  - the database check refuses "on" without both records (removing the check fails this test).
- `apps/web/e2e/ai-gate.spec.ts`, at 360 px and on desktop:
  - switching on without the legal clearance is refused;
  - switching on with both records, then off again, works;
  - a Centre Manager cannot open the page.
  - The test holds a lock and leaves the switch off.
