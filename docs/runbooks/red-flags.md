# Red flags

SET-10, PRD J2.3, J2.6, J3.10 and G2. Two things live here:

- **The red flag rules:** the health form submit (INT-10) runs them over the patient's screening
  answers.
- **Each region's red flag presentations:** clinicians' reference, from the workbooks.

Both are part of a knowledge base version (`docs/runbooks/knowledge-base.md`). Clinicians and
managers read them at `/app/red-flags`, through the "Red flags" link on home
(`knowledge_base.view`: Super Admin, Centre Manager, physiotherapist).

## Sources

- **Rules:** the client's Red Flag Screening Framework, `docs/Red_Flag_Updated (1).docx`. Each
  rule cites its section:
  - §1, universal questions;
  - §2, triage categories;
  - §§3–13, signs per region;
  - §14, the decision tree.
- **Region questions:** PRD J2.3 (back: bladder, bowel and saddle; neck: dizziness and vision).
- **Display:** Frontend Specification "Alert tiers".
- **Presentations:** each workbook's Red Flags sheet, word for word: the presentations, and the
  notes under its "Screening rules" heading.

## Decisions (user, 22 October 2026)

- **Tiers:** the framework's five triage categories, shown as three alert tiers.

  | Triage | Shows as |
  | --- | --- |
  | Immediate emergency | Emergency: the red banner, which stays until a clinician acknowledges it |
  | Urgent medical referral, Urgent imaging, Specialist referral | Review: an amber tag and a task |
  | Monitor with caution | Information |

- **Rule content:** the rules in `packages/db/src/knowledge/red-flag-rules.json` are a **draft**
  mapped from the framework. Every rule is `"signedOff": false` and shows "Awaiting clinical
  sign-off" until the client's clinical lead approves it.
- **Changing rules:** rules are knowledge base data, so a change is a new version that the Super
  Admin approves (SET-06). There is no editing screen.
- **Presentations:** reference only. They are never run automatically; signs that only a
  clinician can find (Ottawa, Homan's, Kocher) belong to the screening checklist (CLN-04) and to
  the tier choice in consultation (CLN-11).

Also decided in the plan:

- **Thresholds:** weight loss (decision #5) and morning stiffness (decision #6) are settings,
  defaulting to the framework's own values: 5 kg within 6 months, and 60 minutes. The client
  confirms them.
- **Missing answers:** an unanswered screening question is never read as "no"; it raises a
  Review ("missing safety answers").

## The questions

`screeningQuestions` in `packages/schemas/src/red-flags.ts`:

- the 15 universal questions, as the framework words them;
- the weight loss amount and period (asked after a yes), and morning stiffness in minutes;
- four back questions and four neck questions.

Each question has a stable key that rules refer to. Patient wording goes through the client's
approval of patient content with the health form (INT-05).

## Writing a rule

```json
{
  "key": "back.cauda_equina",
  "name": "Possible cauda equina syndrome (back)",
  "regions": ["back"],
  "trigger": { "any": [{ "question": "back_bladder", "is": "yes" }] },
  "triage": "immediate_emergency",
  "action": "Stop physiotherapy. Refer to A&E now ...",
  "source": "Framework §4A",
  "signedOff": false
}
```

- **`regions`:** an empty list means everywhere.
- **The trigger** holds when every `all` condition holds and, if `any` is given, at least one
  `any` condition holds. A condition is one of:
  - `{ "question": key, "is": "yes" }`;
  - `{ "question": key, "atLeast" | "atMost": number | { "setting": key } }`;
  - `{ "age": { "atLeast" | "atMost": n } }`.
- **Checks:** the import validates the file (`redFlagRuleSchema`). An unknown question, a rule
  without a condition, or a repeated key stops the import.
- **Keys:** keep a rule's key when changing it. Later records (alerts) refer to the key.

**Every Immediate emergency rule needs its own test.** Add a case to `emergencyCases` in
`packages/db/src/knowledge/red-flag-rules.test.ts`, giving:
- the answers that raise it;
- the regions it must raise in;
- the regions it must stay quiet in.

A guard test fails while an emergency rule has no case.

## Signing off and shipping a change

1. Edit `red-flag-rules.json`. Set `"signedOff": true` on a rule only when the client's clinical
   lead has approved it, and note who and when in the PR.
2. Run `pnpm test`, then `pnpm kb:import`, and commit the regenerated report.
3. After merging, run `pnpm kb:import --apply` on each environment. The rules file's hash is part
   of the version's source, so a changed file becomes the next version, a draft until approved.

## Running the rules

```ts
const result = evaluateRedFlags(rules, answers, { region, age }, thresholds);
// result.raised: most urgent first; result.missing: unanswered questions;
// result.display: 'emergency' | 'review' | 'information' | null
```

`evaluateRedFlags` is pure. INT-10 reads the version's rules (`redFlagRules`) and the three
`screening.*` settings before its transaction, then raises alerts (ALT-01).
