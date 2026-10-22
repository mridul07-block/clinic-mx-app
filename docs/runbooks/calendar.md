# Calendar

SCH-05, PRD M2, Frontend Specification ("Calendar"), design system "Calendar block".

The calendar is the front desk's day at a centre, at `/app/calendar` ("Calendar" on home,
`calendar.view`):

- a column per physio, with the consultant's fee in the header;
- free slots that open the drawer;
- appointment details in the drawer;
- live updates.

The phone agenda (SCH-06) and booking from the drawer (SCH-07) come next.

## Decisions

From the user (22 October 2026):

- **Live updates check every 3 seconds** (`live.refresh_seconds`) until the realtime relay
  (FND-09), which waits for the clinic domain. The header says "Live, updated n s ago". After a
  failed check it says "Not updated for n s. Checking again." in amber.
- **A free slot opens the drawer.** It shows the physio, the time and each appointment type with
  "Fits, 45 min" or why it does not fit (the slot engine's words). Booking a patient there comes
  with SCH-07.
- **The header shows a consultant's own consultation fee** (decision G4; PRD section 7: the fee is
  set by the consulting physio's level). The Super Admin sets it on the staff page ("Consultation
  fee", `staff.manage`), from the price items in `billing.consultation_price_items` (Consultation
  ₹750, Senior consultation ₹1,000), or "Not set". Physios who are not consultants show no fee.

Also decided while building SCH-05:

- **The fee shows only to people who may see prices** (`prices.view`). A physio sees their own
  column without it.
- **Another holder's hold shows as "Being booked"**, a grey cell that cannot be clicked.

## Who sees what

| Role | Calendar |
| --- | --- |
| Super Admin, Centre Manager, Front Desk | Every physio with hours at a centre they see; a centre switch when they see several |
| Physiotherapist | Their own column only (PRD: "own schedule") |
| Finance | None: no link, and the page sends them to Not allowed |

## The page

- **The address carries the view:** `?centre=&date=&appointment=&slot=`. Links, the back button
  and the tests work without scripts. Previous day, Today and Next day are links.
- **Columns** are the physios with hours at the centre that day, by name. Each header holds their
  name, a "Consultant" tag and the fee.
- **Rows** follow the calendar grid (`scheduling.slot_minutes`, 15). There is a solid line on the
  hour and a dotted one on the half hour. The day runs from the earliest start to the latest end
  of anyone's hours. Time outside a physio's hours, or on leave, is sunken.
- **Free cells** are the slot engine's free starts with the grid as the length. Each is a link,
  named "Free at 10:30 with <physio>", and shows "+ 10:30" on hover.
- **Blocks** follow the design system:
  - the left strip is the status (the tone map in `packages/ui/src/status.ts`);
  - Checked in and In progress sit on their tint, and so do Completed and No show;
  - Cancelled and Rescheduled stay in place, hatched, with the time struck through. A booking
    made at the same time since shares the width with them;
  - the top line is the type, with its time when the column is wide (a container query), and
    "Treadmill n" for a machine booking;
  - then the patient and the status in words. Running late is worked out from the start and
    `day.running_late_minutes`.
- **A "now" line** with its time.
- **The grid scrolls inside its panel,** both ways, with the header row and time column sticky,
  so a phone at 360 px never scrolls the page sideways.
- **The drawer** opens on the right (480 px) on a desktop and full width on a phone. Close, or Esc,
  goes back to the plain day.
  - **For an appointment:**
    - its number and status;
    - the patient, linked to their page, and their OP number;
    - when, with whom and where;
    - the treadmill;
    - the channel and who booked it.
  - **Its actions** (check in, reschedule, cancel) come with their tickets.

## Live updates

1. `CalendarView` (a client component) holds the day the server drew.
2. Every `live.refresh_seconds` it asks `/app/calendar/live?centre=&date=&since=<version>`.
3. The route loads the day the same way the page does (under row level security) and returns its
   version. It returns the whole day only when the version differs.
4. The version is a hash of everything drawn (`calendarVersion`).

The check carries the `x-clinic-live` header (`apps/web/lib/live.ts`):

- **The proxy never counts it as activity,** so a desktop left open on the calendar still signs out
  after the idle minutes (IAM-07).
- **It is never logged as a page a support login asked for** (IAM-08).
- **It stays on our domain** (rule 9), and the proxy keeps the session fresh.

When FND-09's relay arrives, the same component listens for changes instead of asking.

## Data

- **`calendarDay`** (`packages/db/src/calendar.ts`) builds the day from the slot engine's shared
  loader (`loadPeople` and `windowsOn` in `packages/db/src/slots.ts`):
  - rosters and approved leave;
  - busy times at every centre and other holders' holds (`internal.busy_times`, times only);
  - the appointments at this centre, with patient, type and who booked;
  - the consultant's fee.
- **`slotOptions`** (`apps/web/modules/scheduling/calendar.ts`) checks each active type at a picked
  start with `slotFit`, the engine's check without holding.
- **`staff_user.consultation_price_item_id`** is audited like every staff change. Only the Super
  Admin updates staff (RLS unchanged).

## Checking it

| Test | What it covers |
| --- | --- |
| `packages/schemas/src/calendar.test.ts` | The fee input (a price item or none); a picked slot from the address |
| `apps/web/modules/scheduling/calendar.test.ts` | The front desk at its centres with fees; a physio's own column without fees; Finance refused; the settings read before the transaction; each type's fit and refusal words |
| `apps/web/modules/consultation-fees/services.test.ts` | A listed fee for a consultant, or none; other items, non-consultants and other roles refused |
| `packages/db/src/integration/calendar.integration.test.ts` | Columns for rostered physios only; free cells without appointments here and at another centre, holds and leave; the fee; appointments with patients for the front desk; a physio's own column; the version changes with the day; the fee audited |
| `apps/web/e2e/calendar.spec.ts` | 360 px and desktop: the fee, a block and its drawer, a free cell and its drawer, Esc closes; a booking made elsewhere appears without a reload; a physio sees their own column; Finance refused; the Super Admin sets a fee |

**Negative check (23 October 2026).** With the live day not applied, the "appears without a
reload" test failed.
