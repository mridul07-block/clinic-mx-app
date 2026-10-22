# Appointment types

SET-03, PRD M2 ("appointment types with configurable length") and section 7 ("Consultation
length"; "Session length: per appointment type and physio"). What can be booked, and how long it
takes with each physio. The slot engine and the calendar (SCH-04, SCH-05) book with these
lengths.

## Decisions (user, 22 October 2026)

- **Types:** the Super Admin adds, renames, changes the length of, deactivates and reactivates
  types. A type is never deleted; deactivated, it is no longer offered for new bookings.
- **Seeded:** the PRD's four types.

  | Type | Length | Source |
  | --- | --- | --- |
  | Consultation | 45 minutes | Decision 2 |
  | Session | 45 minutes | PRD: 45 to 60 |
  | Review | 45 minutes | Placeholder until the client confirms |
  | Zero Gravity Treadmill | 30 minutes | Placeholder until the client confirms |

- **Per physio:** each physio who treats patients may have their own length for any type. A blank
  length uses the type's.
- **Who:** the Super Admin only:
  - types on the Appointment types screen (`settings.manage`);
  - a physio's own lengths on their staff page (`staff.manage`).
- **Audit:** every change is audited.

## Lengths fit the calendar

Every length is a whole number of calendar slots. The slot is the setting `scheduling.slot_minutes`
(15, decision G2: 15 minute slot step, no buffer). A length of 50 is refused: "Use steps of 15
minutes, for example 45." Lengths are capped at 8 hours, as a guard against typing errors.

The global settings `scheduling.consultation_minutes` and `scheduling.session_minutes` were
retired: the types hold those lengths now (`docs/runbooks/settings.md`).

## Screens

| Path | What |
| --- | --- |
| `/app/appointment-types` | Each type: name, length ("1 hour 30 minutes"), Inactive tag, and how many physios have their own length |
| `/app/appointment-types/new`, `/app/appointment-types/[id]` | Name and length in minutes; deactivate (confirm step) or reactivate |
| `/app/staff/[id]`, section "Appointment lengths" | For staff who treat patients. One field per active type, with the clinic length as placeholder; blank uses it. "Save lengths". |

A support login sees them read only (IAM-08).

## For booking

`lengthFor(db, staffUserId, appointmentTypeId)` in `packages/db/src/appointment-types.ts` gives
the physio's own length, else the type's. A type's `key` (`consultation`, `session`, `review`,
`zero_gravity_treadmill`) is made from its name when it is added and never changes, so code may
refer to it.

## Under the hood

| Part | Where |
| --- | --- |
| Schemas, the slot rule, `formatMinutes` | `packages/schemas/src/appointment-types.ts` |
| Tables | `packages/db/src/schema/appointment-types.ts`, migration `20261022082156_appointment_types.sql` |
| Policies, audit triggers, the seed, the slot setting, the retired settings | `20261022082157_appointment_type_rules.sql` |
| Database functions | `packages/db/src/appointment-types.ts` |
| Services | `apps/web/modules/appointment-types/services.ts` |

**Row level security.** Every signed in staff member reads the types and lengths, because booking
needs them. Only the Super Admin writes. Support is read only.

## Checking it

| Test | What it covers |
| --- | --- |
| `packages/schemas/src/appointment-types.test.ts` | Lengths as typed, the slot rule, lengths as read, keys, physio lengths with blanks |
| `apps/web/modules/appointment-types/services.test.ts` | Super Admin only; support read only; whole slots; names and keys in use; physio lengths only for staff who treat patients |
| `packages/db/src/integration/appointment-types.integration.test.ts` | The four seeded types; the retired settings are gone; every role reads; only the Super Admin writes; `lengthFor`; audit of each change (rolled back) |
| `apps/web/e2e/appointment-types.spec.ts` | At 360 px and desktop: change Review with a refused 50; add and deactivate a type; give a physio a Session length of 60 and clear it; Front Desk refused. Tests take turns (`e2e appointment types` lock), and everything is put back. |
