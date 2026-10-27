# Finance dashboards and exports (DSH-04)

These are Finance's Collections, Unpaid, Packages and Revenue screens, with CSV downloads.

- **Sources:** Frontend Specification section 6 (the Finance screens) and the section 8 charts for
  payment method, daily collections, revenue by month against last year, and revenue per centre.
- **Builds on:** DSH-01 (revenue counts payments received), DSH-02 (the charts) and DSH-03 (the
  dashboard pattern).

## Decisions (28 October 2026)

These are recommended defaults chosen under the user's standing approval of 28 October 2026. They
are recorded in the DECISION register as "DSH-04" for the client to confirm.

**Where it is**

- The screens are `/app/finance/collections`, `unpaid`, `packages` and `revenue`, with a tab row.
- They are for the Super Admin and Finance (`dashboard.finance`). The home link is "Finance".
- Finance lands on Collections after signing in (`homePath`).
- The existing Packages list (`/app/packages`) and Prices stay where they are, and the Packages tab
  links to the list.

**How the data is read**

- Everything is read under the reader's own row level security, which lets the Super Admin and
  Finance read every bill, payment and package. The service checks `dashboard.finance` first.
- No new database function is needed. A Centre Manager reads no bills, and the desk reads only its
  own centre's (tested).

**Collections**

- Today's money across all centres, split by method (UPI, card, cash) and by centre.
- Payments undone today are counted and named, never included.
- The last 30 days are shown as columns, with today hatched "so far". There is no target line,
  because no document gives a daily collection target (DECISION DSH-04).

**Unpaid**

- Unpaid bills of either kind, largest first, with:
  - bill number, centre and kind;
  - amount;
  - days since the bill was raised;
  - the patient's OP number. The patient's name is never shown.
- Pay as you go balances and the flag above 3 unpaid sessions come with BIL-10.

**Packages**

- Per centre, with their sessions left:
  - live packages that are active;
  - packages expiring within `packages.expiry_reminder_days`;
  - packages expired with sessions left.
- Each count links to the Packages list.

**Revenue**

- **Basis:** cash basis, meaning payments not undone, on the day they were recorded.
- **Charts:**
  - each of the last 12 months against the same month a year before (grey), with this month
    hatched "so far";
  - this month by centre, in the centre colours;
  - the last 12 months by service (consultation fee or package).
- **Fetching:** the two years are fetched as two calls of one year each.
- **Not built yet:** refunds and credits come with BIL-11.

**CSV**

- Collections, Unpaid and Revenue each download as a CSV through `/app/finance/export/[table]`.
- The route checks the person and `dashboard.finance` (401 or 403 otherwise) and sends
  `no-store`.
- The files have:
  - plain rupees with two decimals;
  - IST dates;
  - bill and OP numbers, never a patient's name.
- A cell that starts like a spreadsheet formula (`=`, `+`, `-`, `@`) gets a leading apostrophe, so
  opening the file never runs one.
- Full data export stays with the Super Admin (`data.export`).

## How it works

| Piece | Where |
| --- | --- |
| Reads | `packages/db/src/finance.ts`: `paymentsDaily`, `paymentsUndone`, `revenueMonthly`, `unpaidBills`, `packageCounts` |
| Pure rules | `packages/schemas/src/finance.ts`: tabs, months against the year before, `csvCell` and `toCsv` |
| Services | `apps/web/modules/reporting/finance.ts`: one view per tab and `financeCsv` |
| Screens | `apps/web/app/(staff)/app/(signed-in)/finance/` and its `export/[table]/route.ts` |

## Tests

| Test | Covers |
| --- | --- |
| `packages/schemas/src/finance.test.ts` | Months across years, CSV quoting and formula guarding |
| `packages/db/src/integration/finance.integration.test.ts` | Payments by day, method and month. Undone payments left out of revenue and counted apart. The desk reads only its own centre and a Centre Manager reads nothing. Unpaid bills come largest first with numbers and no name. Package counts cover active, expiring, and expired with sessions left. |
| `apps/web/modules/reporting/finance.test.ts` | Each view; months against the year before, asked for one year at a time; CSV rows; refusals |
| `apps/web/e2e/finance-dashboards.spec.ts` | At 360 px and on desktop: a temporary Finance login lands on Collections, and HSR Layout's money matches the records. The collections and revenue CSVs download with their headers and no patient name. Every tab fits the screen. A Centre Manager and a physio get no screen (`not-allowed`) and no file (403). |

**Negative check:** without the "not undone" filter, the database test fails because the undone
payment is counted as revenue.

**Review:** an adversarial review confirmed 3 defects, all fixed with tests:

- **Inactive centres:** a deactivated centre's money counted in the totals but was missing from the
  per-centre splits, and its CSV rows showed a raw centre id. Such a centre is now shown by name,
  marked "(inactive)", wherever it has money.
- **Empty charts:** money charts with no payments drew an axis in fractions of a paisa. They now
  show a sentence instead.
- **Calendar spec:** "Finance has no calendar" checked Collections instead of home after the
  landing change. It now opens home first.
