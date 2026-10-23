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
- **Actions:** Check in on To arrive rows and Form and reports on Here now rows, both opening the
  check in drawer (INT-02, below); Undo check in is in the drawer. A no show is marked on the
  appointment in the calendar (INT-11).
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

## Check in drawer (INT-02)

Frontend Specification ("Check in drawer"), PRD J2.1 and J2.2, TAD section 9.

Decisions (user, 23 October 2026):

- **Drawer first, identity ticked.** "Check in" on a To arrive row opens the drawer
  (`/app/today?appointment=<id>`). It shows who this is: OP number, age (or "Date of birth not
  recorded"), "Mobile ending 4321", and for a patient under `patients.adult_age_years` the
  guardians and "A guardian must attend". The desk ticks "I have checked who this is (name and
  date of birth)", then Check in. The appointment records who checked the patient in
  (`checked_in_by`) and when; Undo check in, in the drawer, clears both.
- **The health form is for a first visit for a problem:** an appointment with no episode yet
  (submitting the form creates the episode, INT-10). A visit in an open episode says "No health
  form for this visit: it is part of an open episode."
- **Reports:** the desk adds photos or PDFs and sees the list (kind, size, who, when). Opening them,
  for physios with the Treats patients tick through a 5 minute link, comes with the consultation
  screens (CLN). Deleting a report added by mistake is not built yet.

What the drawer does once the patient is checked in:

- **Form status:** Not sent, Waiting for the patient, Submitted or Link expired, from the
  appointment's latest health form link.
- **Show QR** (`showHealthForm`): reuses the link still waiting, or issues one
  (`issuePatientLink`, `links.health_form_hours`), and shows it as a QR drawn on our server
  (`qrcode`, an SVG data URL) for `<our address>/p/<token>`, never supabase.co, with "Works
  until". "Show a new QR" once one has expired.
- **Open on tablet** (`openFormOnTablet`): the same link goes to a working kiosk tablet at the
  appointment's centre (`sendLinkToKiosk`, IAM-10); with several, the desk picks one; with none,
  "Set one up" goes to Kiosk tablets.
- **Add reports** (`addReports`): photos are redrawn on the device at most 1600 px as JPEG
  before they are sent; PDFs go as they are. Each file is at most `reports.max_file_mb` (4, the
  most a hosted request carries), checked on the device and again on the server, which also checks
  the file's first bytes. The server stores it in the private `reports` bucket at
  `<patient id>/<report id>.<jpg|png|pdf>` with the service role, then records a `patient_report`
  row in the audited transaction; if anything fails, the files stored so far are removed.

Database and access:

- `appointment.checked_in_by`; the check `appointment_arrived` (`NOT VALID`): Checked in needs an
  arrival time and who, set and cleared together.
- `patient_report`: added only by someone with check in rights, as themselves; read by them; no
  changes or deletes; audited. The appointment link is set to null if an appointment is removed.
- `patient_link`: someone with check in rights reads and issues the health form link of an
  appointment they can see (`patient_link_checkin_read`, `patient_link_checkin_issue`); no other
  link, and tokens are never stored.
- The `reports` bucket is private; only our server reaches it. Locally and in CI, `pnpm db:start`
  now runs Supabase's storage service.

## Walk in (INT-12)

Decisions (user, 23 October 2026):

- **"Walk in" on Today** opens the calendar's booking sheets for today (`/app/calendar?...&new=1&walkin=1`).
  The desk:
  1. picks the type;
  2. picks a physio's next free start (no date field);
  3. finds the patient or adds them with a name and mobile;
  4. ticks "I have checked who this is (name and date of birth)";
  5. presses **Book and check in** (for a new patient, **Add, book and check in**).

  It lands on the check in drawer with "Checked in." for the QR, the tablet and reports. The tick
  is kept across a patient search (`ticked=1`). Cancel booking and Close go back to Today.
- **Its own channel.** The booking is the Walk in channel (`walk_in`), and calls stay Front desk.
  Every staff booking records who made it (check `appointment_staff_booked_by`).
- **Next free start only.** The slot engine is the booking's: on the grid and still ahead. A
  patient arriving at 10:07 gets 10:15 or later.

How it works:

- `walkIn` (`apps/web/modules/front-desk/services.ts`) runs one transaction:
  - it needs `check_in.manage` and `bookings.manage` at the centre, the tick, and a start today;
  - it books with `bookFor` (`modules/scheduling/services.ts`, shared with Book);
  - then it checks in by the same person.
- `addPatientAndWalkIn` adds the patient first, as Add and book does (`addPatientThenBook`).
- The sheets show walk-in mode only to someone who both books and checks in, and only for today.

- **Consent declined (INT-06).** A patient who declines a Part A statement shows "Consent
  declined" on their Today row and as the drawer's form status. Speak to them; if they change
  their mind they choose **Change my answer** on the form.

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
- The health form questions (INT-04, INT-05).
- Landing screens for the other roles come with their tickets.

## Checking it

| Test | What it proves |
| --- | --- |
| `packages/schemas/src/today.test.ts` | Each status under one chip; Not confirmed is Booked; check in on the IST day only |
| `apps/web/modules/front-desk/services.test.ts` | Check in for those who check in at the centre; Booked or Confirmed only; the day; undo on the day; the board refused to Physio, Finance and another centre |
| `apps/web/modules/auth/next-path.test.ts` | The Front Desk lands on Today; a page asked for still wins |
| `packages/db/src/integration/slots.integration.test.ts` | Check in and undo with the arrival time; back to Confirmed; refused on another day, from No show, without an arrival time, and an undo another day; audited; the board leaves out Cancelled and is read by the front desk |
| `apps/web/e2e/check-in.spec.ts` | 360 px and desktop: Check in opens the drawer, the identity tick comes first, undo; Show QR opens the health form on another phone; Open on tablet opens it on a kiosk tablet; reports added and listed, a text file and a file over 4 MB refused; a visit in an open episode has no health form |
| `apps/web/modules/front-desk/services.test.ts` (INT-02) | The tick; reuse or issue the link; no form in an open episode; the tablet's centre; report types, sizes and first bytes; files removed when recording fails |
| `apps/web/e2e/walk-in.spec.ts` | 360 px and desktop: Walk in from Today; refused without the tick, kept across a search, then booked as `walk_in` and checked in by the desk in one press; a new patient added, booked and checked in |
| `apps/web/modules/front-desk/services.test.ts` (INT-12) | Walk in books as `walk_in` and checks in in one transaction after the tick; today only; Physio, Finance and another centre refused |
| `apps/web/e2e/today.spec.ts` | 360 px and desktop: the desk lands on Today; tags, "n min late", "Here n min"; chips filter; check in and undo; a booking made elsewhere appears; Physio and Finance refused; the emergency banner full width and red |

**Negative checks (23 October 2026).** With the same day rule taken out of the guard, checking in
an appointment on another day was no longer refused and the database test failed (INT-01). With
`patient_link_checkin_issue` dropped, the database test and "Show QR" failed (INT-02). With
the check in taken out of `walkIn` (book only), the service test and both walk in end to end
tests failed (INT-12).
