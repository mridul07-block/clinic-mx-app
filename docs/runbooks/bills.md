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

## Tests

| Test | Covers |
| --- | --- |
| `packages/db/src/integration/clinical-record.integration.test.ts` (bills at fixed prices, the patient choice) | ₹750 and ₹1,000 by the consultant's fee, numbered in order, made once; only consultations; at check in and cancelled when undone; nothing without a fee, then made by the desk at the centre and not another; read by the desk, Finance and the Super Admin only; no staff change, delete or insert; a package billed and cancelled by a later choice |
| `apps/web/modules/billing/bills.test.ts` | made when due; whose fee is not set; not due; already billed; another centre and a physio refused |
| `packages/db/src/integration/clinical-record.integration.test.ts` (counter payments) | the whole total as the desk, once; another centre, the manager, a physio and support refused; no direct insert, change or delete; Active for a paid package, per session with the fee paid in either order, never while thinking about it; undone on its day with a reason, not by another centre and not the next day |
| `apps/web/modules/billing/payments.test.ts` | the method and the trimmed reference, never an amount; already paid; yesterday's payment; no method; another centre and a physio refused |
| `apps/web/e2e/payments.spec.ts` | 360 px and desktop: no method refused; the package paid by UPI with its reference makes the episode Active; the fee paid by cash clears Today's tag; undone with a reason; nothing for the desk at another centre |
| `apps/web/e2e/bills.spec.ts` | 360 px and desktop: "Unpaid ₹750" on Today; the fee bill on the sheet; a package billed then cancelled; a physio refused; no bills for the desk at another centre; no fee set, then made after the fee is set (Senior, ₹1,000) |

**Negative checks:** let `make_consultation_bill` bill every visit type, and the "bills nothing but a consultation" database test fails; let `activate_if_paid` activate on a paid fee whatever the choice, and the "moves the episode to Active" database test fails.
