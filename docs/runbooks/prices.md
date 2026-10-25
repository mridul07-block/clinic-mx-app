# Price master

SET-02, PRD section 7 ("Current price master"), TAD section 4. The price master holds the clinic's:

- **list prices** (`price_item`);
- **package types** (`package_type`, with what each covers in `package_type_item`);
- **preset discounts** (`discount_preset`).

Billing reads them:

| Ticket | What it uses |
| --- | --- |
| BIL-01 plan sheet | Per session (the session types in `billing.session_price_items`) and package options, modalities per use; `docs/runbooks/plan-sheet.md` |
| BIL-05 bills | Fixed prices; the consultation fee by physio level |
| BIL-07 | Preset discounts at the desk |
| BIL-08 | Packages |

## Who

| Role | Can |
| --- | --- |
| Finance, Super Admin | Add, edit, deactivate and reactivate (`prices.manage`) |
| Centre Manager, Front Desk | Read the lists (`prices.view`; decision C3: Centre Managers see list prices, never patient bills) |
| Physiotherapist | Nothing: no Prices link, and the database returns no rows |
| Velyx support | Read only (IAM-08) |

Nothing is deleted; a row is deactivated and kept. The audit log is the price history: every
change records who made it, with the row before and after.

## Decisions (user, 22 October 2026)

- **Package type:** a name, a number of sessions, a fixed package price that Finance enters, and the
  price items it covers. Validity and reschedules are clinic-wide settings, not per type:
  `packages.validity_months` (3) and `packages.reschedules_per_10_sessions` (1).
- **Preset discount:** a name and either a whole percent (1 to 100) or a flat amount.
- **Seed:** the PRD's eight prices, added by migration `20261022074002_price_rules.sql`.

## Still open (PRD section 10)

| # | Decision | Until then |
| --- | --- | --- |
| 8 | What each package covers | No package types; Finance adds them when the clinic agrees |
| 15 | Preset discount types | No discounts; Finance adds the clinic's list |
| 16 | Laser and dry needling prices | Not listed; Finance adds them with Add a price |
| 17 | Tax treatment on invoices | Prices are the amount the patient pays (`// DECISION #17`) |

## Screens

| Path | What |
| --- | --- |
| `/app/prices` | Three sections: Price list, Package types, Preset discounts. Amounts in tabular figures. Rows open for those who keep prices; Add links for Finance and the Super Admin. |
| `/app/prices/items/new`, `/app/prices/items/[id]` | A price's name and amount; deactivate (confirm step) or reactivate |
| `/app/prices/packages/new`, `/app/prices/packages/[id]` | Name, sessions, package price, and what it covers, as checkboxes of active price items. An inactive item a type already covers stays listed, marked. |
| `/app/prices/discounts/new`, `/app/prices/discounts/[id]` | Name, then a percent or a flat amount |

**Amounts.** Typed as people write them (`1500`, `1,500`, `₹1,500.50`) and stored in integer
paise (`rupeesSchema`). They are shown with Indian grouping (`formatRupees`: `₹18,40,000`). Both
are in `packages/schemas/src/money.ts`, for billing to reuse.

**Keys.** A price item's `key` is made from its name when it is added (`Dry needling` becomes
`dry_needling`) and never changes. Settings and code refer to items by key, for example
`zero_gravity_treadmill` in `packages.never_reschedulable_items`. Renaming an item keeps its key.

**Existing bills.** A changed price applies to new bills; bills copy the amount when they are made
(BIL-05).

## Under the hood

| Part | Where |
| --- | --- |
| Schemas | `packages/schemas/src/prices.ts`, `money.ts` |
| Tables, checks (amount above 0; a discount has only the field its kind needs; names unique ignoring case) | `packages/db/src/schema/prices.ts`, migration `20261022073945_prices.sql` |
| Policies, the audit triggers, `internal.jwt_views_prices()`, `internal.jwt_manages_prices()`, the seed | `20261022074002_price_rules.sql` |
| Database functions | `packages/db/src/prices.ts` |
| Services: a `staffService` on `prices.manage` for each add, edit and activate | `apps/web/modules/prices/services.ts` |

## Checking it

| Test | What it covers |
| --- | --- |
| `packages/schemas/src/money.test.ts`, `prices.test.ts` | Amounts as typed and shown; keys; package and discount fields |
| `apps/web/modules/prices/services.test.ts` | Finance and Super Admin only; support read only; names and keys in use; covered items exist and are active |
| `packages/db/src/integration/prices.integration.test.ts` | The eight seeded prices; the package setting's keys exist; RLS per role; audit rows as the person; table checks (each test rolled back) |
| `apps/web/e2e/prices.spec.ts` | At 360 px and desktop: Finance edits a price with a field error; Finance adds a package type and two discounts and deactivates one; the front desk reads only; a physiotherapist is refused. Tests take turns (`e2e prices` lock), and `e2e/prices.ts` restores the list and removes "E2E …" rows. |
