# Slots and booking

SCH-04, PRD J1.3, J1.5, J1.8 and section 7, TAD sections 4, 6 and 8.

The slot engine is what every booking path uses:

- the front desk's booking sheet (SCH-07);
- the calendar (SCH-05, SCH-06);
- the WhatsApp Flow (WA-04);
- reschedules (SCH-08).

It finds free starts, holds one while someone chooses, and books it. Overbooking is not allowed
(PRD section 7, fixed), and the database makes it impossible.

## Decisions

From the kickoff review (21 October 2026):

- **G2:** the calendar grid is 15 minutes (`scheduling.slot_minutes`) with no buffer. Machines are
  resources with a count per centre (Zero Gravity Treadmill, default 1). Exclusion constraints
  refuse physio and machine overlaps.
- **G6:** appointment IDs start MVH, MVK and MVW.

From the user (22 October 2026):

- **A Zero Gravity Treadmill appointment takes the physio and one of the centre's treadmills.**
- **Consultation and Review are booked only with a physio who has the Consultant tick.** Session
  and Zero Gravity Treadmill go to anyone who treats patients.
- **The appointment prefix lives on the centre,** next to its code, and never changes. IDs read
  like `MVK-00042`, numbered per centre.
- **The engine comes first.** The screens come with SCH-05 and SCH-07.

Also decided while building SCH-04:

- **Channels** are the PRD section 7 pair: `whatsapp` and `front_desk`. A front desk booking
  records who made it (`booked_by`).
- **A slot starts in the future.** A walk in takes the next free start.
- **The hold lasts `booking.slot_hold_minutes`** (5, from TAD section 6). A holder (`staff:<id>`
  now, a Flow session with WA-04) has at most one live hold; a new hold replaces the old one.
- **Holds are not audited.** They last minutes, and the appointment booked is the event. Every
  appointment insert and change is audited.

## Which starts are free

For a centre, a date and an appointment type, a start is free for a physio when:

1. **The physio may take the type.** They are active, treat patients, have hours at the centre
   that day (their roster), and have the Consultant tick if the type needs it
   (`appointment_type.needs_consultant`).
2. **It sits on the grid,** counted from midnight IST, and is after now.
3. **The whole appointment fits inside their hours,** with approved leave cut out. The length is
   the physio's own for the type, or else the type's (`lengthFor`, SET-03).
4. **It overlaps nothing busy:** the physio's appointments at every centre (all but Cancelled and
   Rescheduled), and other holders' live holds. Touching ends are fine, because there is no buffer.
5. **For a machine type** (`appointment_type.machine`), one of the centre's units is free. The
   booking records which unit (1 to the centre's count).

The rules are pure functions, `slotStarts` and `checkSlot`, in `packages/schemas/src/slots.ts`.
`packages/db/src/slots.ts` loads the data for them in a handful of batched queries:

- `freeSlots`: one day, per physio;
- `datesWithFreeSlots`: the dates with any free start, for Flow screen 1.

**Busy times come through two functions:** `internal.busy_times` and `internal.machine_busy`.
They are SECURITY DEFINER and return times only, never who or why. Without them, a front desk
could not see a physio's appointments at another centre or their leave (both hidden by row level
security), and would offer slots that are not free. They refuse anyone who is not staff or the
server.

**Speed.** At the PRD's volume (about 2,850 appointments a month), batched queries on the TAD's
index (centre, physio, start) are enough, so availability is not precomputed. With about 47,000
appointments loaded, a day takes about 60 ms locally and 30 days about 115 ms. The target is
under 2 s.

## Holding and booking

`placeHold` and `bookAppointment` run inside the caller's transaction:

1. **Lock.** They take advisory transaction locks: the physio first, then the centre's machine.
   The fixed order means no deadlock.
2. **Release expired holds** (`internal.release_expired_slot_holds`).
3. **Recheck** the start by the rules above. The holder's own hold does not count as busy.
4. **Write** the hold (replacing the holder's earlier one), or the appointment (giving the hold
   back).

A refusal is a `SlotRefusedError` whose message is shown as it is:

| Refusal | Message |
| --- | --- |
| `taken` | This slot was just booked. Pick another time. |
| `past` | That time has passed. Pick a later time. |
| `off_grid` | Pick a start time on the calendar grid. |
| `outside_hours` | The physio does not work at this centre then. Pick another time. |
| `no_machine` | No Zero Gravity Treadmill is free then. Pick another time. |
| `not_offered` | That physio does not take appointments at this centre. |
| `needs_consultant` | This appointment is booked with a consultant. Pick a consultant physio. |
| `type_inactive` | That appointment type is no longer offered. |

**The database is the last guard.** While an appointment keeps its slot, two exclusion constraints
refuse an overlap even if a lock were missed: one per physio, and one per centre machine unit.
Holds have the same two. A refusal (23P01) becomes `taken`.

**Expired holds** are also removed every minute by pg_cron (`slot-hold-release`).

## The `appointment` table

- **Columns:** number, patient, centre, physio, type, episode (optional), start and end, status,
  channel, `booked_by`, machine and unit, `confirmed_at`, `arrived_at`.
- **Statuses:** Booked, Confirmed, Checked in, In progress, Completed, Cancelled, Rescheduled, No
  show (Frontend Specification). The buttons that move them come with their tickets (SCH-08, INT,
  OUT).
- **The number** comes from the `appointment_number` trigger: the centre's prefix and its next
  number from `centre_sequence`.
- **What was booked never changes:** the number, patient, place, physio, type, time and channel
  (`appointment_fixed`). A reschedule books a new appointment and marks the old one Rescheduled
  (SCH-08). PRD J1.7 releases the old slot only after the new one is booked, so both steps happen
  in one transaction.

**Access** (`docs/runbooks/row-level-security.md`):

- the Super Admin, Centre Managers and the Front Desk read and book at the centres they see;
- a physio reads their own appointments;
- nobody deletes;
- support is read only.

## Services

`apps/web/modules/scheduling/services.ts`, all `bookings.manage` at a centre the person sees:

- `findFreeSlots(actor, query)`;
- `holdSlot(context, choice)`;
- `bookSlot(context, booking)`: the patient must exist, and an episode given must be the patient's
  and not discharged.

They read the settings before the transaction opens (SET-03). WA-04 will call the engine in
`packages/db` as the system, with a Flow session as the holder.

## Checking it

| Test | What it covers |
| --- | --- |
| `packages/schemas/src/slots.test.ts` | The grid, windows, leave and breaks, busy overlaps and touching ends, past starts, machine units, the IST grid; `checkSlot` agrees with `slotStarts` on every grid time |
| `apps/web/modules/scheduling/services.test.ts` | Roles and centres; the front desk channel and `booked_by`; patient and episode checks; settings read before the transaction |
| `packages/db/src/integration/slots.integration.test.ts` | Free starts with an appointment at another centre, leave and holds, seen by a front desk; consultant types; treadmills; the exclusion constraints; numbers and fixed fields; holds; refusals; busy times for staff only; access by role; the audit row |
| `packages/db/src/integration/slots-load.integration.test.ts` | 10 people booking one slot at once (exactly one wins); overlapping starts; one treadmill; a held slot; the speed test |

**Negative check (22 October 2026).** Without the physio lock and the physio exclusion
constraint, all 10 concurrent bookings of one slot succeeded and the test failed.
