# Plan and payment sheet

BIL-01, PRD J4.2 ("the front desk sees the recommended plan read only and payment options
calculated from the price master: pay per session or a package"), Frontend Specification section 7.
The sheet is the start of Stage 4; the patient's choice (BIL-02), Part B consent (BIL-03), the bill
(BIL-05), payment (BIL-06) and packages (BIL-08) are added to it by their tickets.

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

## Where it is enforced

- **The plan:** the front desk reads no plan of care (clinicians only). The sheet reads it through
  `internal.plan_for_pricing(episode_id)` (`20261025014830_plan_sheet_rules.sql`), a security
  definer function returning only the columns above, to the Super Admin, Finance, and the front desk
  at the episode's centre. A desk at another centre sees the patient (records are shared across
  centres) and "No plan yet".
- **The page:** `requirePermission('bills.view_amounts')`; the service `planSheetOf`
  (`apps/web/modules/billing/plan-sheet.ts`) checks the same.

## Tests

| Test | Covers |
| --- | --- |
| `packages/schemas/src/plan-sheet.test.ts` | totals, frequency not set, modality prices, packages covering the session, cover wording, rounding |
| `packages/db/src/integration/clinical-record.integration.test.ts` | who `plan_for_pricing` answers, and nothing clinical in it |
| `apps/web/modules/consultations/services.test.ts` | signing proposes the plan; On hold stays |
| `apps/web/e2e/plan-sheet.spec.ts` | 360 px and desktop: from Today, the plan, ₹12,000, the modality, a package, Advanced at ₹18,000 with no package, a physio refused, the desk at another centre sees no plan |

**Negative check:** let `plan_for_pricing` answer any centre's desk, and the database test fails
for the Koramangala desk.
