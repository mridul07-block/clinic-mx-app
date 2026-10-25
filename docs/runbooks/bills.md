# Bills

BIL-05: "Bills at fixed prices". Sources: PRD J4.6 ("Prices cannot be edited at the desk") and §7 (the consultation fee by the consulting physio's level; the fee timing setting), and TAD §4 and §9. Decisions made by the user on 25 October 2026.

Payment is BIL-06 (below); discounts (BIL-07), package activation (BIL-08) and the invoice PDF (BIL-09) come with their own tickets. Per-session and per-use modality bills come with the session tickets.

## Who makes a bill

Only the database makes bills, at the price master's amounts. Nobody types a price.

| Bill | Made when | Amount |
| --- | --- | --- |
| Consultation fee | A consultation visit reaches the moment set by `billing.consultation_fee_timing`: `after_consultation` (default) when it becomes Completed; `at_check_in` when it is Checked in, walk-ins included | The consultant's own fee price item (`staff_user.consultation_price_item_id`, set by the Super Admin on Staff from `billing.consultation_price_items`: Consultation ₹750, Senior consultation ₹1,000) |
| Package | The patient chooses a package on the plan and payment sheet (BIL-02) | The package type's price |

**Further rules:**
- **One per visit:** each visit gets one consultation fee bill. Making it again returns the same bill.
- **Other visit types:** sessions, reviews and treadmill visits get no consultation fee.
- **Undone check-in:** with `at_check_in`, undoing a check-in cancels the unpaid bill ("Check in was undone.").
- **Choice changed:** any later choice cancels the episode's unpaid package bills ("The patient chose differently.").
- **No fee set:** no bill is made. The sheet says "Consultation fee not set for <consultant>. Ask the Super Admin to set it on Staff." Once the fee is set, the desk presses "Make the consultation bill", which applies the same rules (`internal.consultation_bill_now`).
- **Referred out:** the fee is charged as normal until the client decides otherwise (DECISION 13).
- **The 6-week review:** it is not billed until the client says whether it is charged (also DECISION 13).

**Numbers:** the centre's code, then `B`, then the centre's next bill number, for example `HSR-B-00001`. They come from `centre_sequence` (kind `bill`), so there are no gaps and no repeats. They are shown in Plex Mono.

## Where

**The plan and payment sheet:** the Bills section lists each bill with:
- its number and kind
- a status tag: Unpaid, Paid, or Cancelled with the reason
- its lines and total

**Today:** a row with an unpaid consultation fee shows "Unpaid ₹750" to those who see amounts.

## Where it is enforced

The rules are in `supabase/migrations/20261025103430_bills_rules.sql`:

- **Reading:**
  - Bills are read by those who see amounts at the bill's centre (`internal.prices_centre`): the Super Admin, Finance, and the front desk there.
  - Lines are read through their bill.
  - Centre Managers and physios never read amounts. Their payment-pending and sessions-left views come with later tickets.
- **Writing:**
  - Staff have no INSERT, UPDATE or DELETE on `bill` or `bill_line`.
  - Velyx support is read-only.
  - The functions `internal.make_consultation_bill`, `internal.consultation_fee_bill` (a trigger on `appointment`) and `internal.package_bill` (a trigger on `plan_choice`) write bills as security definer.
- **Checks:** a consultation bill names its visit and a package bill its choice. A line's amount is its quantity × unit, and it names one price item or one package type. A cancelled bill has its time and reason.
- **Services:**
  - `makeConsultationBill` (`apps/web/modules/billing/bills.ts`) requires `bills.create_and_collect` at the episode's centre.
  - The sheet reads bills through `planSheetOf`.

## Payments (BIL-06)

PRD J4.6 and J4.7. Decisions made by the user on 25 October 2026.

- **Marking a bill paid:** on an unpaid bill, the front desk at its centre (or Finance, or the Super Admin) picks how the patient paid (UPI QR, Card or Cash) and can add a reference of up to 40 characters, such as the UPI transaction ID or the card slip number. Then they press "Mark paid ₹750".
  - The database records the bill's whole total. Nobody types an amount, and partial payments wait for the client (DECISION 10).
  - It records the payment as the person signed in and marks the bill Paid.
  - There is one live payment per bill.
- **Plan proposed → Active:** the episode moves once the chosen plan is paid for. Either the newest choice is a package and its bill is paid, or the newest choice is pay per session and the consultation fee is paid. This is checked after every payment and every choice (`internal.activate_if_paid`), so paying the fee first and choosing per session later also activates. Activating the package itself (sessions, expiry) is BIL-08.
- **Undo:** a payment recorded by mistake is undone on its IST day by the same people, with a reason ("Undo payment"). The bill goes back to Unpaid and the episode stays as it is. After that day it is a refund, which Finance handles (a later ticket).
- **Shown with each paid bill:** the method, the reference and who recorded it when. Today's "Unpaid" tag clears.

**Enforced:** staff have no INSERT, UPDATE or DELETE on `payment`. The functions `internal.record_payment` and `internal.undo_payment` (security definer, `supabase/migrations/20261025111438_payments_rules.sql`) check that the person takes payment at the bill's centre (`internal.collects_at`; never Velyx support). The services `recordBillPayment` and `undoBillPayment` (`apps/web/modules/billing/payments.ts`) check `bills.create_and_collect` there too.

## Invoices and receipts (BIL-09)

Frontend Specification §11, TAD §9 and PRD J4.7. Decisions made by the user on 25 October 2026.

- **Numbers:** recording a payment gives it the centre's next invoice number, for example `HSR-INV-00001`. This series is separate from bill numbers (`centre_sequence` kind `invoice`), so invoices run without gaps whatever bills were cancelled. A number is never given to another payment. Paying again after an undo gets a fresh number.
- **The PDF:** the same transaction queues `documents.invoice`, and the job makes the "Invoice and receipt" PDF on the centre's letterhead (`apps/web/modules/documents/invoice.tsx`). It shows:
  - the invoice and bill numbers, the date and the centre
  - the patient (name, OP number)
  - the items with quantity, price and amount, and the total
  - how it was paid (method, reference, amount, when, received by)
  - for a package: its name, sessions and "Valid until 28 Feb 2027 (3 months from payment)". The expiry runs from the payment date with `packages.validity_months`, falling on the month's last day when needed (`packageValidUntil`); BIL-08 uses the same rule.
- **Left out for now:** discounts (BIL-07), tax (decision 17) and legal details (DECISION ALT-05).
- **Undo:** undoing the payment queues the invoice again. Version 2 opens with "Cancelled: the payment was undone on <date>. <reason>".
- **Receipt:** `whatsapp.receipt` is queued with each payment and sends nothing until WhatsApp exists. Its sender must skip a payment since undone and send the newest invoice.
- **Where:**
  - a paid bill on the sheet links "Invoice HSR-INV-00001 (PDF)", or says it is being made until the job runs
  - those who see amounts without clinical access find "Invoices" on the patient record's Overview
  - the Super Admin finds it on the Documents tab
  - it opens from our domain for those who see amounts at its centre (`docs/runbooks/documents.md`)

## Packages (BIL-08)

PRD J4.7 and section 7, TAD section 4, Frontend Specification (package meter, Finance's Packages tab). Decisions made by the user on 25 October 2026.

- **Activated on payment:** paying a package's bill makes the patient's package (`package` table, `internal.activate_package`). It gets:
  - the type's sessions and name (copied, so reading it needs no price)
  - valid until `packages.validity_months` after the IST payment date, on the month's last day when it has no such day (30 Nov plus 3 months is 28 Feb; the same rule as the invoice, `packageValidUntil`)
  - `floor(sessions / 10) × packages.reschedules_per_10_sessions` reschedules, rounded down (6 sessions allow none, 12 allow 1). Using one up is SCH-10.
- **Expiry reminder:** the same transaction queues `whatsapp.package_expiry_reminder` for `packages.expiry_reminder_days` (14) before the last day at `packages.expiry_reminder_time` (10:00) IST. It sends nothing until WhatsApp exists.
- **State, worked out from the row (`packageState`):** Cancelled when its payment was undone; Used up when every session is used; Expired once its last day has passed; otherwise Active. Nothing runs at expiry. An expired package keeps its sessions left on record, and nobody can use them; credits and extensions wait for the client (DECISION 12, BIL-11).
- **Using a session:** `internal.use_package_session(package_id)` uses one session of an active package and returns the sessions left, refusing a cancelled, used up or expired one. Staff cannot call it; SES-07 calls it when a session is closed.
- **Undo:** undoing the payment cancels the package ("The payment was undone."), but only while no session from it has been used. After that the desk is refused and it is Finance's refund (BIL-11). Paying again makes a fresh package.
- **Who reads it:** those who see amounts at its centre (the Super Admin, Finance, the front desk there) and physios at their centres; never Centre Managers. The table holds no amounts, so physios read it directly for the sessions left (decision 21 October 2026). Nobody signed in writes one.
- **Where:**
  - the plan and payment sheet's "Package" section and the patient record's Overview ("Packages"): the meter with sessions used of total, valid until and reschedules left, tagged Active, Expiring (within the reminder days), Used up, Expired or Cancelled
  - `/app/packages` (home link "Packages") for those who see amounts: Active, Expiring in 14 days, and Expired with sessions left, soonest expiry first

## Tests

| Test | Covers |
| --- | --- |
| `packages/db/src/integration/clinical-record.integration.test.ts` (bills at fixed prices, the patient choice) | ₹750 and ₹1,000 by the consultant's fee, numbered in order, made once; only consultations; at check in and cancelled when undone; nothing without a fee, then made by the desk at the centre and not another; read by the desk, Finance and the Super Admin only; no staff change, delete or insert; a package billed and cancelled by a later choice |
| `apps/web/modules/billing/bills.test.ts` | made when due; whose fee is not set; not due; already billed; another centre and a physio refused |
| `packages/db/src/integration/clinical-record.integration.test.ts` (counter payments) | the whole total as the desk, once; another centre, the manager, a physio and support refused; no direct insert, change or delete; Active for a paid package, per session with the fee paid in either order, never while thinking about it; undone on its day with a reason, not by another centre and not the next day |
| `apps/web/modules/billing/payments.test.ts` | the method and the trimmed reference, never an amount; already paid; yesterday's payment; no method; another centre and a physio refused |
| `apps/web/e2e/payments.spec.ts` | 360 px and desktop: no method refused; the package paid by UPI with its reference makes the episode Active; the fee paid by cash clears Today's tag; undone with a reason; nothing for the desk at another centre |
| `packages/db/src/integration/clinical-record.integration.test.ts` (counter payments) | invoice numbers in the centre's own series, consecutive and fresh after an undo; the invoice and receipt jobs per payment and the invoice again on undo; the invoice's facts |
| `apps/web/modules/documents/invoice.test.tsx` | the numbers, patient, items and payment; the package's expiry at month end; a consultation by cash without a reference; no tax or discount; the cancelled notice; the PDF; keyed, never twice |
| `apps/web/e2e/invoices.spec.ts` | 360 px and desktop: paid, the invoice is being made, then after the tick its link opens a PDF; listed under Invoices; undone, version 2 after the tick; the desk at another centre cannot open it |
| `packages/db/src/integration/clinical-record.integration.test.ts` (counter payments) | packages: activated by the package bill only, with sessions, reschedules, valid to the month's end and the reminder at 10:00 AM IST; a session used only while active and only by the system; the undo cancels it, refused once a session is used; read by the desk, Finance, the Super Admin and its physio, not another centre or the manager; nobody writes one |
| `packages/schemas/src/packages.test.ts` | the state on its last day and the day after, used up, cancelled; reschedules rounded down |
| `apps/web/e2e/packages.spec.ts` | 360 px and desktop: paid by UPI, the sheet's meter "0 of 12 used · Valid until … · 1 reschedule left"; the patient record lists it; Finance's Active, Expiring in 14 days and Expired with sessions left; nothing for the desk at another centre; the physio sees the sessions and no price; the undo cancels it |
| `apps/web/e2e/bills.spec.ts` | 360 px and desktop: "Unpaid ₹750" on Today; the fee bill on the sheet; a package billed then cancelled; a physio refused; no bills for the desk at another centre; no fee set, then made after the fee is set (Senior, ₹1,000) |

**Negative checks:** let `make_consultation_bill` bill every visit type, and the "bills nothing but a consultation" database test fails; let `activate_if_paid` activate on a paid fee whatever the choice, and the "moves the episode to Active" database test fails; drop the invoice job from `undo_payment`, and the invoice numbering database test fails; drop the package from `record_payment`, and the four package database tests fail.
