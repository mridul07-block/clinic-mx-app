# Refunds

BIL-11: "Refunds and credits (decisions 9, 12)". Done when: Finance only; reason and approver
stored. Sources: PRD section 3 (refunds are the Super Admin's and Finance's, "Full"; the desk has
none), M8 ("refunds and credits by Finance"), section 8 (every refund stored with who and when);
TAD `refund_credit` (amount, reason, approved by) and section 9 ("refunds and credits need
Finance"); Frontend Specification section 6 ("Refunds and credits: requests, approvals, history").

Decision 9 (the refund policy's wording) and decision 12 (unused sessions at expiry or discharge:
lost, extended or credited) are still the client's. Everything below is a recommended default,
chosen under the user's standing approval on 28 October 2026 (DECISION BIL-11), and decides no
client policy: the system checks who, how much and why, and leaves whether a refund is due to
Finance.

## What it does

- **Who:** Finance and the Super Admin (`refunds.manage`), never Velyx support. The front desk, a
  Centre Manager and physios have none. "Finance only" in the ticket is read as "not the desk":
  the PRD gives the Super Admin full access to refunds too.
- **Where:** Finance, Refunds (`/app/finance/refunds`). Find a paid bill by its bill or invoice
  number (as printed, any case), then record the refund: the amount in rupees, how the money went
  back (UPI QR, card or cash), an optional reference, and why. Recording it is the approval: the
  person's name is kept on the refund ("Approved by …"). The newest 50 refunds are listed below,
  by bill number and centre, never the patient's name.
- **How much:** what Finance types, never more than was paid less earlier refunds; several
  refunds on one payment are allowed. No pro rata, no time limit, no eligibility rule
  (`// DECISION 9` in the migration).
- **What it changes:**
  - **The package:** a refund of the whole payment closes its live package ("Refunded."); its
    sessions used stay on record, and no session or reschedule can be used after. A partial
    refund leaves the package as it is.
  - **The bill** stays Paid, so it is never paid again.
  - **The episode** is never touched (rule 1: money never closes or changes care).
  - **The desk's same-day undo** is refused once a refund was given: the money would go back
    twice.
  - **Documents and messages:** none. No credit note or new invoice version is specified; tax and
    legal details wait for decision 17.
- **On the plan and payment sheet:** each refund shows under the payment ("Refunded ₹2,000 by
  Cash, … · Approved by … · reason"), for everyone who sees the bill.
- **Credits:** not built (decision 12). The Refunds tab says so. When the client decides, a
  `kind` column (refund or credit) is added to `refund_credit` by a forward migration.

## Figures

- **Revenue** (Finance's Revenue tab, its CSV, the Super Admin's Overview and the revenue figure
  of `/app/figures`) is net of refunds, each counted on the day and in the month it was given,
  keeping the cash basis. A month with more refunded than taken shows below zero.
- **Collections** stay the money taken in that day; refunds are counted apart, "N refunded today
  (₹X), counted in Revenue", as undone payments are.

## Where it is enforced

| Rule | Where |
| --- | --- |
| Only `internal.refund_payment` writes a refund; staff have no insert, update or delete | `REVOKE` in `*_refunds_rules.sql` |
| Finance or the Super Admin, never support | `internal.refund_payment` (role check), restrictive support policies |
| A payment not undone; a reason; never more than paid, under a lock on the payment | `internal.refund_payment` |
| Amount above ₹0; reference up to 40 characters; reason 1 to 300 characters | `refund_credit` checks |
| A full refund closes the live package | `internal.refund_payment` |
| No same-day undo after a refund | `internal.undo_payment` |
| Read with the bill: those who see amounts at its centre | `refund_credit_read` |
| Audited as the person | `audit_change` on `refund_credit` |

Code: `packages/db/src/refunds.ts`, `apps/web/modules/billing/refunds.ts`,
`packages/schemas/src/refunds.ts`, `finance/refunds/page.tsx`. Revenue: `revenueMonthly` and
`refundsDaily` in `packages/db/src/finance.ts`; `internal.kpi_daily`.

## Tests

| Test | Covers |
| --- | --- |
| `packages/db/src/integration/clinical-record.integration.test.ts` (counter payments, refunds) | Finance and the Super Admin refund with the reason, reference and name, audited; the desk, another centre, the manager, a physio and support refused; no direct insert; the bill stays paid; the desk at the centre reads it, another centre does not; over what is left, no reason and an undone payment refused; the desk's undo refused after a refund; a partial refund leaves the package, the rest closes it, no session used after; the episode unchanged; the bill never paid again |
| `packages/db/src/integration/finance.integration.test.ts` (refunds in the figures) | revenue, its figure and the day's refunds net of a refund; collections gross |
| `packages/schemas/src/refunds.test.ts` | numbers as printed; rupees to paise; no amount, method or reason, a long reference refused |
| `apps/web/modules/billing/refunds.test.ts` | Finance and the Super Admin record; the desk, the manager, a physio and support refused; refusals in plain words; the lookup |
| `apps/web/modules/reporting/finance.test.ts`, `overview.test.ts` | refunded today counted apart; the week's revenue less refunds |
| `apps/web/e2e/refunds.spec.ts` | 360 px and desktop: the desk sells a package; Finance finds it by number, needs a reason, refunds ₹2,000 and sees it listed with their name; more than is left refused; the desk sees the refund and no undo; the rest refunds it in full and closes the package; the desk is sent away from Refunds |

**Review (28 October 2026):** an adversarial review found the desk's undo on a page loaded before
a refund ending on an error page (now "Finance has refunded this payment, so it cannot be
undone."), the Revenue page and the figure still worded as gross, a huge second refund overflowing
instead of being refused (compared as bigint now), the fifth Finance tab cut off at 360 px (the
open tab now scrolls into view, `components/tab-row.tsx`), and no announcement after a full refund
(now a status line). All are fixed with tests.

**Negative check (28 October 2026):** with the role check taken out of `internal.refund_payment`,
the database test refusing the desk failed.
