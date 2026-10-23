# Today board

INT-01, Frontend Specification ("Front Desk": Today, the Front Desk's home; "Today board row";
"Emergency banner"), PRD J2.1.

The Today board is the front desk's day at a centre, at `/app/today` (`check_in.manage`: the
Super Admin, Centre Managers and the Front Desk; "Today" first on Home). The Front Desk lands on it
after signing in; everyone else still lands on Home.

## Decisions

User, 23 October 2026:

- **Check in in one tap.** "Check in" on a row sets Checked in and the arrival time, which starts
  the waiting timer. "Undo check in" puts a mistake right on the appointment's day: back to
  Confirmed if the patient had confirmed, otherwise Booked. The Check in drawer (INT-02) adds the
  identity check, form status, QR and reports around it.
- **Done is Completed and No show.** Cancelled and Rescheduled are left off the board; they stay on
  the calendar.
- **The Front Desk lands on Today.** Its header links to Home, Calendar and Patients, with New
  booking; Account, Prices and Sign out are on Home.

## The board

- **Chips** (they count and filter; the one picked stays in the address as `?show=`): All,
  To arrive (Booked and Confirmed), Here now (Checked in), With physio (In progress), Done
  (Completed and No show), and Not confirmed (Booked, still to arrive; the morning's list of
  people to call).
- **Rows by time:** start and end (a link to the appointment on the calendar), the patient (a link
  to their page), type and physio, the status tag and the action.
- **Status tags and waiting time:** "Here n min" in blue from the arrival time; Running late in
  amber with "n min late" (`day.running_late_minutes`, the calendar's own rule); No show in red;
  Completed in grey. A coloured strip on the left repeats the status.
- **Actions:** Check in on To arrive rows; Undo check in on Here now rows. A no show is marked on
  the appointment in the calendar (INT-11).
- **On a phone** each row is a card: the tag and waiting time sit under the name, the action
  beside them. On desktop it is one line per appointment.
- **Live:** the board asks `/app/today/live` every `live.refresh_seconds` with its version; only a
  changed board comes back ("Live, updated n s ago", or amber "Not updated for n s" while checks
  fail). The timers count every second. The check never counts as activity for the idle sign out.
- **Emergency banner:** the slot sits above the board. It is filled by open emergency alerts once
  red flag alerts exist (INT-10); until then it is empty. The banner itself (full width, solid red,
  "Clinician review needed before … leaves.", one action) is in
  `apps/web/components/emergency-banner.tsx`, shown by the test harness page
  `/app/test-harness/emergency-banner`.

## Rules

- **The service** (`checkIn`, `undoCheckIn` in `apps/web/modules/front-desk/services.ts`):
  `check_in.manage` at the appointment's centre; only Booked or Confirmed is checked in, only on
  the appointment's IST day; the undo only on that day.
- **The database** (`appointment_status_guard`) refuses the same whatever the code does:
  Checked in only from Booked or Confirmed on the appointment's IST day, and back to Booked or
  Confirmed only on that day. The check `appointment_arrived` needs an arrival time while Checked
  in. Every change is audited.
- **Reading:** `todayBoard` (`packages/db/src/today.ts`) lists the centre's appointments that day
  for every physio, whatever their hours, under the reader's row level security.

## Not yet

- Notifying the physio on check in (PRD J2.1) comes with notifications.
- The Check in drawer (INT-02), the appointment linked QR (INT-03) and walk ins (INT-12).
- Landing screens for the other roles come with their tickets.

## Checking it

| Test | What it proves |
| --- | --- |
| `packages/schemas/src/today.test.ts` | Each status under one chip; Not confirmed is Booked; check in on the IST day only |
| `apps/web/modules/front-desk/services.test.ts` | Check in for those who check in at the centre; Booked or Confirmed only; the day; undo on the day; the board refused to Physio, Finance and another centre |
| `apps/web/modules/auth/next-path.test.ts` | The Front Desk lands on Today; a page asked for still wins |
| `packages/db/src/integration/slots.integration.test.ts` | Check in and undo with the arrival time; back to Confirmed; refused on another day, from No show, without an arrival time, and an undo another day; audited; the board leaves out Cancelled and is read by the front desk |
| `apps/web/e2e/today.spec.ts` | 360 px and desktop: the desk lands on Today; tags, "n min late", "Here n min"; chips filter; check in and undo; a booking made elsewhere appears; Physio and Finance refused; the emergency banner full width and red |

**Negative check (23 October 2026).** With the same day rule taken out of the guard, checking in an
appointment on another day was no longer refused and the database test failed.
