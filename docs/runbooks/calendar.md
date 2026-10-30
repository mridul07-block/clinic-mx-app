# Calendar

SCH-05, PRD M2, Frontend Specification ("Calendar"), design system "Calendar block".

The calendar is the front desk's day at a centre, at `/app/calendar` ("Calendar" on home,
`calendar.view`):

- a column per physio, with the consultant's fee in the header;
- free slots that open the drawer;
- appointment details in the drawer;
- live updates.

On a phone it is an agenda, with details in a bottom sheet (SCH-06, below). The front desk books
from it (SCH-07, below).

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
  of anyone's hours, widened to the slot grid around any appointment outside them (INT-01 found
  one at 03:45 drawn under the header). Time outside a physio's hours, or on leave, is sunken.
- **Free cells** are the slot engine's free starts with the grid as the length. Each is a link,
  named "Free at 10:30 with <physio>", and shows "+ 10:30" on hover.
- **Blocks** follow the design system:
  - the left strip is the status (the tone map in `packages/ui/src/status.ts`);
  - Checked in and In progress sit on their tint, and so do Completed and No show;
  - Cancelled and Rescheduled stay in place on the left half of the column, hatched, with the
    time struck through. A booking made at the same time since, or the free cells there, take
    the right half, so freed time can be clicked and booked (fixed in SCH-09);
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

## The phone agenda (SCH-06)

Below 768 px (the Frontend Specification's phone width) the calendar is an agenda instead of the
grid (`agenda-list.tsx`, rows from `agendaRows` in `agenda.ts`). Both are drawn from the same live
day and switched with CSS, so there is no width check in scripts.

Decisions (user, 23 October 2026):

- **It opens on Everyone:** every appointment at the centre in time order (then by physio), each
  row naming its physio.
- **Chips pick one physio** (`physio=` in the address, kept by the day links and Close). Their
  agenda has their name, Consultant tag and fee, and adds their free time: each gap of free cells
  ("Free 09:45 to 10:30") with a 44 px chip per start that opens the slot sheet. The Everyone list
  shows appointments only, to stay short.
- **A physio** has only their own column, so only their agenda, without chips. With one physio at
  the centre that day, their agenda shows directly.

Each row is at least 44 px: the start and end, the patient, the type (with the physio in Everyone
and "Treadmill n"), the status tag, and the status strip on the left. Cancelled and Rescheduled
stay hatched with the time struck. A "now" line sits before the first later row.

**The bottom sheet.** On a phone the drawer is a sheet across the bottom: full width, up to 90% of
the screen, rounded top corners, sliding up in 240 ms (`animate-sheet` in
`packages/ui/src/styles/motion.css`), with the safe area respected. Close and Esc work as on the
desktop. A footer is pinned at the bottom for the primary action (Frontend Specification section 4).
Today only the slot sheet uses it, for its note; Book (SCH-07), check in, reschedule and cancel
arrive with their tickets. There is no swipe to close.

## Booking at the front desk (SCH-07)

PRD J1.5: the front desk books callers and walk ins on the same slot engine as WhatsApp, and every
booking records its channel and who made it. Only `bookings.manage` books (Super Admin, Centre
Managers, Front Desk); physios and support logins see no Book buttons, and the services refuse
them too.

Decisions (user, 23 October 2026):

- **Two ways in.** A free slot's sheet has "Book" on each type that fits. "New booking" (the
  calendar's primary action) picks the type and day, then shows each physio's free starts
  (`findFreeSlots`).
- **The start is held when the type is picked,** for `booking.slot_hold_minutes` (5). Others see
  "Being booked". The booking sheet says "Held for you until 10:35" (`currentHold`), or that the
  hold ran out (Book still works if the time is free: the engine rechecks).
- **After Book, the sheet shows the new appointment** with "Booked MVH-00012".

The booking sheet (`booking-sheet.tsx`, `booking-forms.tsx`, `modules/scheduling/actions.ts`):

1. **The held start:** the type, day and time, physio and centre.
2. **Find the patient** by mobile or name (`find=` in the address, as on the Patients page). Each
   result has Book.
3. **New patient:** a name and mobile only, registered at the calendar's centre, which issues the OP
   number. A mobile already on file lists its patients first, each with Book, or "Add <name> as a
   new person and book" (the SCH-01 rule). When the time is taken after the patient was added,
   the patient stays and the message says so.
4. **Cancel booking** (pinned at the bottom) gives the hold back. Close or Esc leave it to run out.

Holding is a post (a server action), never a link: Next.js fetches links ahead, which would hold
slots. Every booking from here is `front_desk` with `booked_by` set, audited. The WhatsApp
confirmation (J1.5) comes with the WhatsApp tickets; the sheet says so.

## Reschedule and cancel (SCH-08)

From an appointment's sheet, someone who books (Super Admin, Centre Manager, Front Desk) gets
"Reschedule" and "Cancel appointment" in the pinned footer, while it is Booked or Confirmed.

Decisions (user, 23 October 2026):

- **Booked or Confirmed, any time until check in,** including a patient running late who phones
  to move. Any other status cannot change.
- **A move keeps the type.** The picker starts on the appointment's own day and physio, and any
  day and physio at the centre can be chosen. It books a **new appointment number**; the old one
  shows "Rescheduled to MVH-…", the new one "Moved from MVH-…".
- **Who asked is "By the patient" or "By the clinic",** required, with who did it and when. No
  free text. SCH-09 counts the patient's reschedules from this.
- **The patient's own move on WhatsApp** (WA-05, `docs/runbooks/whatsapp.md`, "The reschedule
  Flow") is the same reschedule, by the patient, with no staff member: `change_channel` is
  `whatsapp` and `changed_by` is empty. The sheet shows "By the patient, on WhatsApp". Only the
  server records it (`appointment_change_channel_server`); a signed in change always names its
  staff member.

How it holds together:

- **One transaction** marks the old appointment Rescheduled and books the new one, so if the new
  start is refused nothing changes (PRD J1.7: the old time is given up only for the new booking).
- **The old appointment's own time counts as free while moving it** (`freeing` in the slot
  engine), so 10:00 can move to 10:30 with the same physio. The busy times carry no ids, so the
  one entry with its physio and times is taken out, and its treadmill unit's.
- **In the database:**
  - `change_reason`, `changed_at` and `changed_by` are set exactly when the status is Cancelled
    or Rescheduled (`appointment_change`; `NOT VALID`, so rows from before SCH-08 stay as they
    were);
  - `appointment_status_guard` lets only Booked or Confirmed become Cancelled or Rescheduled, and
    a Cancelled or Rescheduled appointment never changes again;
  - the new appointment's `rescheduled_from_id` is unique and never changes (`appointment_fixed`).
- **The cancel sheet is its own confirmation** (who asked, then Cancel appointment, or Keep it).
- **Not here:**
  - messages to the patient (WhatsApp tickets);
  - the counters and self booking block (SCH-09);
  - package reschedules and treadmill rules (SCH-10);
  - late cancellation charges (open decision 11).

## Self booking block (SCH-09)

PRD J1.8: after 2 reschedules or 2 verified no shows (`booking.self_booking_block_reschedules`,
`booking.self_booking_block_no_shows`), the patient can no longer book themselves and is asked to
call; the front desk can still book them.

Decisions (user, 23 October 2026):

- **Only reschedules asked by the patient count.** A move "by the clinic" never does.
  Cancellations do not count either (the PRD names reschedules and no shows).
- **A Centre Manager or the Super Admin lifts the block** ("Allow self booking again" on the
  patient's page, `bookings.lift_self_booking_block`): both counts go back to zero, with who and
  when. Otherwise the counts never expire.

How it works:

- **The database counts** (`booking_counter`, one row per patient): the trigger
  `count_booking_change` on appointment adds a reschedule when the status becomes Rescheduled
  with `change_reason = 'patient'`, and a no show when it becomes No show (set only when the front
  desk confirms it, INT-11 and ALT-04). Every path counts the same way. The migration counted
  what was there before.
- **Reading:** those who book (Super Admin, Centre Manager, Front Desk) read the counts; only a
  Centre Manager or the Super Admin updates them; nobody inserts or deletes except the trigger.
  Audited.
- **`selfBookingBlock`** (`packages/schemas/src/slots.ts`) decides, from the counts and the two
  settings, whether the patient is blocked and why. The WhatsApp Flow (WA-04) uses it before
  offering times.
- **The front desk never checks it:** booking, adding and booking, and rescheduling all still work
  for a blocked patient.
- **The patient's page** shows "Can book on WhatsApp" or "Self booking blocked: 2 reschedules
  asked by the patient", the counts against the limits, and the last lift.

## Package reschedule allowance (SCH-10)

PRD section 7 (Package reschedules) and the Frontend Specification's Reschedule screen. Decisions made by the user on 25 October 2026.

- **Package session:** an appointment of a type in `packages.session_appointment_types` (Session, Zero Gravity Treadmill) in an episode with an active package: not cancelled, sessions left, not past its last day. Consultations and reviews never are, and neither is a session without a package.
- **What uses the allowance:** a reschedule asked by the patient uses one of the package's reschedules (set when it was paid, BIL-08: 1 per 10 sessions, rounded down). A move asked by the clinic never uses one and is always possible.
- **Refused at the patient's request:**
  - with no reschedules left ("No reschedules left in this package. Only a move asked by the clinic is possible.")
  - for a type in `packages.never_reschedulable_items` (Zero Gravity Treadmill). These are price item keys, matched against the appointment type's key, which is the same key.

  The desk can still cancel and book again; whether a cancelled package session is lost is decision 11.
- **Enforced in the database:** `internal.package_reschedule()`, a BEFORE trigger on the appointment's change to Rescheduled. A refusal stops the whole move, and the old appointment stays as it was. The front desk and the WhatsApp Flow (WA-04) follow the same rule, and the trigger lowers `package.reschedules_left` for any reader.
- **Shown:** the reschedule sheets carry a line for those who see packages (not the Centre Manager): "Package session: 1 reschedule left. A move asked by the patient uses one.", "no reschedules left", or "never moved at the patient's request". The package meter shows the reschedules left.

## Book plan sessions (SCH-11)

PRD J4.8: "Book plan sessions" books the whole series at once, resolving clashes on the spot, and
one WhatsApp message lists the dates. The Frontend Specification puts it on the Plan and payment
sheet. Decisions made by the user on 26 October 2026.

- **Where and when:** a "Book plan sessions" section on the Plan and payment sheet (after
  Package), with "12 planned · 2 booked · 0 done · 10 to book · package: 8 left".
  - Before payment: "Book plan sessions once the plan is paid." The form appears once the episode
    is Active.
  - Who: those who book at the episode's centre and see the sheet (the Super Admin, the front
    desk), never a support login. Finance sees the counts only.
- **How many:** the plan's sessions a week × weeks, less the episode's session appointments
  booked (Booked, Confirmed, Checked in, In progress) or done (Completed). With a package, never
  more than its sessions left less those booked (`planSessionsToBook`). Session appointments are
  the types in `packages.session_appointment_types`; the series books the first of them (Session).
- **Pattern:** a start date (today or later), as many weekdays as the plan's sessions a week
  ("Tick 2 days: the plan is 2 a week."), one time on the grid, and a physio who takes sessions at
  the centre, the plan's treating physio suggested.
- **Check dates:** the dates are the ticked weekdays from the start date (`seriesDates`), checked
  by the slot engine in one load (`seriesFit`). A date that is not free shows why ("The physio is
  booked then", "The physio is not working then") and offers:
  - the `booking.plan_clash_alternatives` (3) nearest free times that day with the same physio
  - the nearest free time the next day
  - Skip

  The series' own sessions count as busy for these, so a next day pick never lands on another
  session of the series (`seriesRows`).
- **Book sessions:** needs a pick or Skip on every date that is not free. One transaction records
  the series (`plan_booking`) and books each start with the engine's recheck under lock, as the
  desk (channel Front desk). Any start no longer free refuses the whole series: "Tue 27 Oct 2026,
  10:00 AM is no longer free. Nothing was booked. Check dates again." The desk's own hold is left
  alone (the series books as `plan-series:<staff id>`).
- **Database:**
  - `plan_booking`: the pattern and who booked it; audited; read and recorded by those who book
    at its centre, as themselves; never changed or deleted.
  - `plan_booking_guard`: only into an Active episode at its own centre.
  - `appointment.plan_booking_id`: the series' appointments, with its episode, centre, physio and
    type (`appointment_plan_booking`); the link never changes (`appointment_fixed`).
  - `plan_sessions_list`: queues one `whatsapp.plan_sessions_list` job per series. It completes
    without sending until WA-06 (template `plan_sessions_list`).
- **Done:** "Booked 12 sessions. The plan sessions list is queued for WhatsApp." with each date and
  appointment number; with nothing left, "All planned sessions are booked."

| Piece | Where |
| --- | --- |
| The count, dates, clash rows and pattern | `packages/schemas/src/plan-sessions.ts` |
| The series check and the counts | `seriesFit`, `physiosForType` (`packages/db/src/slots.ts`); `packages/db/src/plan-sessions.ts` |
| Check and book | `apps/web/modules/scheduling/plan-sessions.ts`, `plan-sessions-actions.ts` |
| The form | `apps/web/app/(staff)/app/(signed-in)/plans/[episodeId]/plan-sessions-form.tsx` |

### Tests

| Test | Covers |
| --- | --- |
| `packages/schemas/src/plan-sessions.test.ts` | the count with and without a package; dates across weeks and months; the nearest times; a clash's alternatives, never on the series' own session; the pattern and the starts |
| `apps/web/modules/scheduling/plan-sessions.test.ts` | the counts and the package cap; not offered before payment, to Finance or at another centre; the check's settings; refusals (days, start date, physio, unpaid, all booked); the series recorded then booked; more than left and a start no longer free refused; support read only |
| `packages/db/src/integration/plan-sessions.integration.test.ts` | the series check in one load; a series booked by the desk with one list queued; the link fixed, never deleted; refused for another centre's desk, a physio, support, an unpaid episode, another booker, and another physio's appointment |
| `apps/web/e2e/plan-sessions.spec.ts` | 360 px and desktop: unpaid, then paid with 12 to book; one day refused; 12 dates with one clash and its choices; booking waits for a pick, then books 12 with one list queued; nothing left |

**Negative check:** let the clash alternatives ignore the series' own sessions, and the schema
test "never offers a next day time on the series' own session that day" fails.

## Physio books the next session (SCH-12)

The PRD's access table gives physios "Own schedule; book a patient's next session". Decisions
made by the user on 26 October 2026.

- **Where:** a "Next session" panel on the session screen, under the note. It is there while the
  draft is open and once the session is signed, for the note's writer only: whoever started it
  (cover, SES-08), else the booked physio. Readers (the booked physio when covered, colleagues,
  the Super Admin) and support logins never see it. It needs `bookings.book_next_session`.
- **When:** only in an Active episode. It shows "11 to book", with the same cap as Book plan
  sessions (`sessionsLeft`, shared with SCH-11); with nothing left, "All planned sessions are
  booked."
- **Picking:**
  - a date, offered first as today plus 7 over the plan's sessions a week (rounded, at least a
    day; `nextSessionDate`), today or later
  - "Show times" lists their own free starts that day at the visit's centre (the slot engine,
    Session type)
  - tap one, then "Book next session"
- **Booking:** with the physio, in the visit's episode, booked by them (channel Front desk, a staff
  booking), rechecked under lock with no hold (holder `next-session:<staff id>`). A time taken
  meanwhile is refused in the slot engine's words. The panel then shows "Booked Tue 27 Oct 2026,
  9:00 AM · MVH-00251", and the summary card's next visit updates.
- **Database:**
  - `appointment_next_session`: a physio inserts an appointment only with themselves, booked by
    themselves, at a centre they work at, with the Treats patients tick, into an Active episode
    they have a visit in (booked on or started, in progress or done: `internal.books_next_session`).
  - `internal.episode_session_counts`: counts only, so a physio's cap includes appointments with
    colleagues they cannot read. `episodeSessionCounts` uses it for both SCH-11 and SCH-12.

| Piece | Where |
| --- | --- |
| The panel, the times, booking | `apps/web/modules/scheduling/next-session.ts`, `next-session-actions.ts` |
| The cap | `sessionsLeft` in `apps/web/modules/scheduling/plan-sessions.ts` |
| The form | `apps/web/app/(staff)/app/(signed-in)/sessions/[appointmentId]/next-session.tsx` |

### Tests

| Test | Covers |
| --- | --- |
| `packages/schemas/src/plan-sessions.test.ts` (nextSessionDate) | the date from the frequency, at least a day, a week without one |
| `apps/web/modules/scheduling/next-session.test.ts` | the panel for the writer only, in an Active episode; their own times only; booked as them in the visit's episode; refused for a reader, an unpaid plan, nothing left, another centre, Finance, support |
| `packages/db/src/integration/plan-sessions.integration.test.ts` (SCH-12) | a physio books in their own Active episode and counts colleagues' sessions; refused for an episode they have no visit in, another physio's slot, an unpaid plan, support |
| `apps/web/e2e/next-session.spec.ts` | 360 px and desktop: 11 to book with the date 4 days on; their times; a pick needed; booked, 10 left, the card's next visit; a colleague reads with no panel |

**Negative check:** let `internal.books_next_session` skip "they have a visit in the episode", and
the database test refusing another physio's episode fails.

## 6 week review (OUT-06)

Done when the 6 week Review is booked automatically with the plan, with the consultant (PRD J6.1).
Decisions (user, 26 October 2026):

- **When:** once, when the episode turns Active (its plan chosen and paid). The database queues
  `review.book` from `internal.review_booking_job` (key `review.book:<episode id>`). Under review
  and back to Active, or any other change, queues nothing more.
- **Who and when:**
  - with the consultant who signed the consultation, at the episode's centre
  - on the plan's review date (the visit date plus `clinical.review_weeks`, or whatever the
    consultant set), at their first free time
  - If they are off or full, the following days within `scheduling.review_search_days` (7) are
    tried. A review date already passed starts from today.
- **How it is booked:**
  - The slot engine does the booking (`freeSlots`, then `bookAppointment` in a savepoint, so a
    start taken meanwhile moves on to the next).
  - Channel `automatic` ("Booked: Automatically"), with no booker; `appointment_staff_booked_by`
    allows that only for `whatsapp` and `automatic`.
  - Not billed (DECISION 13).
- **Nothing free:**
  - The front desk at the centre gets a task, "Book the 6 week review", on the patient.
  - The card reads "Review due <date> with <consultant>. No free time found up to <date>."
  - The desk books it from New booking and closes the task.
- **Already booked:** a job that runs again, or finds a Review in the episode that is not
  cancelled or moved, books nothing.
- **No message yet:** the confirmation joins the WhatsApp tickets.

| Piece | Where |
| --- | --- |
| The search dates | `reviewSearchDates`, `packages/schemas/src/plan.ts` |
| The facts and the task | `reviewBookingFacts`, `addReviewBookingTask`, `packages/db/src/review-booking.ts` |
| The run | `runReviewBooking`, `apps/web/modules/scheduling/review-booking.ts`; handler in `apps/web/modules/jobs/handlers.ts` |
| The trigger, the setting | `supabase/migrations/20261026152401_review_booking.sql` |
| The channel and the booker check | `20261026152348_review_channel.sql`, `20261026153005_automatic_booker.sql` |
| The task card line | `ReviewToBook` in `tasks/page.tsx` |

### Tests

| Test | Covers |
| --- | --- |
| `packages/schemas/src/plan.test.ts`, `tasks.test.ts` | the dates tried (from today once the date has passed); the task's details |
| `apps/web/modules/scheduling/review-booking.test.ts` | the first free time on the date, as the scheduling system; the next day when off, past a start taken meanwhile; the task after the setting's days; a passed date starts today; nothing when not Active, already booked or without a signed plan |
| `packages/db/src/integration/review-booking.integration.test.ts` | queued once on turning Active, not before, not again after Under review; staff cannot add the job; the facts; booked with no booker; a cancelled Review no longer counts; the desk's task |
| `apps/web/e2e/review-appointment.spec.ts` | 360 px and desktop: the Review on the consultant's day at 10:00, booked automatically; with no time a 45 minute Review fits, the desk's task |

**Negative check:** drop the trigger's `WHEN` (status becomes Active), and the database test
fails ("not before Active").

## Running late and no show (INT-11)

PRD J2.9: "Running late" shows at 15 minutes past the start; the front desk can mark a no show
from 25 minutes. Both are settings: `day.running_late_minutes` and `day.no_show_allowed_minutes`.

Decisions (user, 23 October 2026):

- **A confirm sheet,** like Cancel: "Mark no show" on the appointment opens "Mark MVH-… as a no
  show? It counts toward the self booking block.", and its red button marks it.
- **Undo the same day:** a no show marked by mistake (the patient walks in at 28 minutes) is
  undone by those who check in until the end of the appointment's day in IST. It goes back to
  Confirmed if the patient had confirmed (`confirmed_at`), otherwise Booked, and the count goes
  back down. Both changes are audited.

How it works:

- **Running late is worked out, not stored** (`shownStatus` in `calendar-block.tsx`): Booked or
  Confirmed, not checked in, and past the start by the setting. Amber on the grid, the agenda and
  the drawer; the calendar's live check redraws it.
- **Who:** `check_in.manage` (Super Admin, Centre Manager, Front Desk), at their centres. A
  physio sees Running late and No show but no actions.
- **The drawer** (for those who check in, once the start has passed): before the setting's
  minutes, "No show can be marked from 10:25."; from then, "Mark no show". A no show shows
  "Marked by …, date time" and, on its day, "Undo no show".
- **The service** (`markNoShow`, `undoNoShow` in `modules/scheduling/services.ts`) reads the
  setting before the transaction and refuses too early, anything but Booked or Confirmed, and an
  undo on another day.
- **The database** records `no_show_at` and `no_show_by` (the check `appointment_no_show`: set
  exactly when the status is No show). `appointment_status_guard` lets an appointment become No
  show only from Booked or Confirmed after its start, and leave No show only back to Booked or
  Confirmed on its own IST day. `count_booking_change` adds a no show and takes one back on an
  undo, never below zero (a lift in between stays lifted).
- **No show keeps its time:** only Cancelled and Rescheduled free a slot.
- **What follows a no show** (the call task, the clinical review after two in a row, the queued
  message) is ALT-04: `docs/runbooks/no-shows.md`. The Today board (INT-01) uses the same rules.

## Live updates

1. `CalendarView` (a client component) holds the day the server drew, and gives it to both the
   agenda and the grid.
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
| `apps/web/app/(staff)/app/(signed-in)/calendar/agenda.test.ts` | Everyone by time without free time; one physio's free cells merged into gaps; the now row; the physio in the address |
| `packages/schemas/src/calendar.test.ts` | The fee input (a price item or none); a picked slot from the address |
| `apps/web/modules/scheduling/calendar.test.ts` | The front desk at its centres with fees; a physio's own column without fees; Finance refused; the settings read before the transaction; each type's fit and refusal words |
| `apps/web/modules/consultation-fees/services.test.ts` | A listed fee for a consultant, or none; other items, non-consultants and other roles refused |
| `packages/db/src/integration/calendar.integration.test.ts` | Columns for rostered physios only; free cells without appointments here and at another centre, holds and leave; the fee; appointments with patients for the front desk; a physio's own column; the version changes with the day; the fee audited |
| `apps/web/modules/scheduling/services.test.ts` | Cancel gives back one's own hold only; a new caller is added at the booking's centre and booked as the front desk; a mobile on file returns its patients first; a refused time keeps the added patient; a name and mobile are required |
| `packages/db/src/integration/slots.integration.test.ts` | `currentHold`: one's own live hold only, under row level security. SCH-08: freeing lets a move overlap its own time; a refused move leaves the old one Booked; the status guard (never changed again, a Completed one not cancelled, who asked required); one successor, the link fixed; audited |
| `packages/schemas/src/slots.test.ts` | Only Booked or Confirmed changes; who asked is the patient or the clinic, always given |
| `apps/web/e2e/reschedule.spec.ts` | 360 px and desktop: cancel by the patient (who asked is required; the time is free again); move to another day and physio (new number, "Moved from", "Rescheduled to", by the clinic); move to an overlapping time with the same physio; a physio cannot change appointments |
| `packages/db/src/integration/clinical-record.integration.test.ts` (the package reschedule allowance) | a patient-asked move of a package Session uses one, the next is refused and leaves it Booked, the clinic's is free; consultations, reviews, an expired package, no package and an undone payment not counted; a treadmill package session refused at the patient's request, moved by the clinic; the sheet's state |
| `apps/web/e2e/package-reschedules.spec.ts` | 360 px and desktop: a paid 12-session package's Session moved at the patient's request ("1 reschedule left"), then "no reschedules left", refused for the patient, moved for the clinic; the meter at 0 |
| `apps/web/e2e/booking-block.spec.ts` | 360 px and desktop: two reschedules asked by the patient block self booking and the desk still books them; one asked by the clinic does not count; a Centre Manager lifts the block |
| `apps/web/e2e/booking.spec.ts` | 360 px and desktop: book a patient found by mobile from a free slot ("Booked MVH-…", "Front desk, by …"); add a new caller and book; a mobile on file lists its patients; New booking by type and day; Cancel gives the slot back; a time taken meanwhile is refused in the engine's words; a physio cannot book |
| `apps/web/e2e/no-show.spec.ts` | 360 px and desktop: at 20 minutes Running late with "No show can be marked from" and no Mark button; at 30 minutes the desk marks a no show through the sheet (No show, marked by the desk, counted on the patient's page) and undoes it (Booked, the count back to 0); a physio sees Running late but no actions |
| `apps/web/e2e/calendar.spec.ts` | Desktop: the fee, a block and its drawer, a free cell and its drawer, Esc closes. 360 px: the same through the agenda (Everyone with the physio named, a physio chip with the fee, the bottom sheet across the screen's foot, a free start chip), no sideways scroll. Both: a booking made elsewhere appears without a reload; a physio sees their own column; Finance refused; the Super Admin sets a fee |

**Negative checks (23 October 2026).** With the live day not applied, the "appears without a
reload" test failed (SCH-05); with the agenda given the day as first drawn, it failed on the phone
(SCH-06); with Cancel not releasing the hold, "Cancel booking gives the slot back" failed (SCH-07); without `freeing`, the overlapping move test failed, and without
`appointment_status_guard`, the database guard test failed (SCH-08); with every reschedule counted, "a reschedule asked by the clinic does not count"
failed (SCH-09); with the undo not taking the count back down, the database no show test and
"marks a no show … and undoes it" failed (INT-11).
