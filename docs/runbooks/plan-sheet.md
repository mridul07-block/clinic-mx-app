# Plan and payment sheet

BIL-01, PRD J4.2 ("the front desk sees the recommended plan read only and payment options
calculated from the price master: pay per session or a package"), Frontend Specification section 7.
The sheet is the start of Stage 4; the patient's choice (BIL-02, below), Part B consent (BIL-03),
the bill (BIL-05), payment (BIL-06) and packages (BIL-08) are added to it by their tickets.

## Where

`/app/plans/<episode id>`, for those who see bill amounts (`bills.view_amounts`: the front desk,
Finance, the Super Admin). Reached from:

- **Today:** a completed consultation in the Done group shows "Plan and payment";
- **the patient record** (Overview, for those without clinical access): each Plan proposed or
  Active episode.

Signing a consultation now moves its episode to Plan proposed (`propose_plan`), unless a red flag
has put it On hold (`docs/runbooks/episodes.md`).

## What it shows (user decisions, 25 October 2026)

| Part | What |
| --- | --- |
| Recommended plan (read only) | Frequency, planned sessions (sessions a week × weeks), the planned modalities by name, the treating physio, the review date. Nothing clinical: no diagnosis, goals, findings or notes |
| Session type | The active price items in `billing.session_price_items` (default Rehabilitation session and Advanced rehabilitation session), chosen by the desk; a plain form (`?session=<key>`) |
| Pay per session | Planned sessions × the session's price; the unit price alone when the plan has no frequency. Each planned modality at its price per use beside it, not added in; "Price not set" where the price master has none (laser and dry needling await decision 16) |
| Packages | The active package types covering the chosen session item: price, sessions, price a session, how much of the plan they cover ("Covers 10 of 12 planned sessions"), "Valid 3 months from payment" (`packages.validity_months`); "No packages set up yet" until Finance adds them (decision 8) |

Prices come from the price master (`docs/runbooks/prices.md`) and are never edited here. The
arithmetic is `planOptions` in `packages/schemas/src/plan-sheet.ts`, tested on its own.

## Bills (BIL-05)

The Bills section lists the episode's bills: the consultation fee once it is due, and the package bill when one is chosen, each with its number, status, lines and total. It also shows the fee-not-set message or "Make the consultation bill". It shows even before there is a plan. Each unpaid bill has "Mark paid" (UPI QR, Card or Cash, optional reference; BIL-06), and a paid one shows how it was paid, with "Undo payment" on its day. Paying for the chosen plan moves the episode to Active. See `docs/runbooks/bills.md`.

## The patient's choice (BIL-02)

PRD J4.3: "The patient's choice (package, per session, think about it, no thanks) is recorded against
the recommended plan. Declining keeps all clinical information." User decisions, 25 October 2026:

| Choice | Stored | What follows |
| --- | --- | --- |
| Package | The package offered for the session type on the sheet, and that session type | Nothing yet; consent and payment come with BIL-03 onwards |
| Pay per session | The session type | The same |
| I'll think about it | Nothing more | At `billing.think_about_it_follow_up_time` (10:00 AM IST) on the `billing.think_about_it_follow_up_days`th day (2): a call task for the front desk at the episode's centre (`call.think_about_it`) and the WhatsApp nudge (`whatsapp.think_about_it`, sent once WhatsApp exists) |
| No thanks | Nothing more | Nothing: the episode stays Plan proposed with all its clinical information; the consultant decides on discharge |

- **When:** only while the episode is Plan proposed, and against its newest plan. Once it is Active,
  On hold or Discharged the sheet shows the recorded choice without the form.
- **Changes:** a new choice can be recorded at any time; every choice is kept (table `plan_choice`,
  audited, never changed or deleted) and the newest counts. Earlier choices are listed under it.
- **The follow up** is queued by the database when the choice is recorded (staff cannot add jobs),
  at the `follow_up_at` the database works out from the two settings. When it runs it does nothing
  if the patient has chosen since, the plan has a newer version or the episode has left Plan
  proposed; a choice that already has its task gets nothing more.
- **No expiry:** how long a "think about it" plan stays valid is PRD decision 14, waiting on the
  client; until then it has none (DECISION register).
- **The episode** is never changed by a choice (rule 1); payment activates it (BIL-06).

## Where it is enforced

- **The plan:** the front desk reads no plan of care (clinicians only). The sheet reads it through
  `internal.plan_for_pricing(episode_id)` (`20261025014830_plan_sheet_rules.sql`), a security
  definer function returning only the columns above, to the Super Admin, Finance, and the front desk
  at the episode's centre. A desk at another centre sees the patient (records are shared across
  centres) and "No plan yet".
- **The page:** `requirePermission('bills.view_amounts')`; the service `planSheetOf`
  (`apps/web/modules/billing/plan-sheet.ts`) checks the same.
- **The choice:** the service `recordPatientPlanChoice` (`apps/web/modules/billing/plan-choice.ts`,
  `bills.create_and_collect` at the episode's centre; Plan proposed; a package offered for the
  session type) and row level security (`20261025083138_plan_choice_rules.sql`): read by those who
  price the episode (`internal.prices_episode`), inserted only as oneself, only while Plan
  proposed and against the newest plan (`internal.records_plan_choice`); no updates or deletes.

## Tests

| Test | Covers |
| --- | --- |
| `packages/schemas/src/plan-sheet.test.ts` | totals, frequency not set, modality prices, packages covering the session, cover wording, rounding |
| `packages/db/src/integration/clinical-record.integration.test.ts` | who `plan_for_pricing` answers, and nothing clinical in it |
| `apps/web/modules/consultations/services.test.ts` | signing proposes the plan; On hold stays |
| `packages/schemas/src/plan-choice.test.ts` | the form's fields read as a choice; nothing chosen, a package without an id and a session without a type refused |
| `apps/web/modules/billing/plan-choice.test.ts` | a package offered for the session recorded against the newest plan; a package not covering the session, a session type not offered, not Plan proposed, no plan, another centre's desk and a physio refused |
| `packages/db/src/integration/clinical-record.integration.test.ts` (the patient choice) | the follow up at day 2, 10:00 AM IST and its job; who reads; refused at another centre, as someone else, by support, not its plan, once Active; never changed; the task and nudge once, nothing after a newer choice or once Active |
| `apps/web/e2e/plan-choice.spec.ts` | 360 px and desktop: nothing chosen refused, "I'll think about it" with its follow up date, the call task after the tick, a package then counting with the earlier choice kept, No thanks keeps Plan proposed, a physio refused, the desk at another centre has no form |
| `apps/web/e2e/plan-sheet.spec.ts` | 360 px and desktop: from Today, the plan, ₹12,000, the modality, a package, Advanced at ₹18,000 with no package, a physio refused, the desk at another centre sees no plan |

**Negative checks:** let `plan_for_pricing` answer any centre's desk, and the database test fails
for the Koramangala desk; drop the newest choice check from `thinkAboutItFollowUp`, and the
"nothing after a newer choice" database test fails.
