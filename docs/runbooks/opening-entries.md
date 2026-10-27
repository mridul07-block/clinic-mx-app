# Opening entries (SCH-13)

PRD section 3 (phase 5: "opening entries for patients already in treatment") and section 10 ("no
existing patient data to import; patients already in treatment get an opening entry before
launch"). Ticket SCH-13: name, mobile, physio, remaining sessions, package expiry.

## Decisions (user, 27 October 2026)

- **Only the Super Admin** makes and corrects them, at `/app/opening-entries` (home link "Opening
  entries", permission `opening_entries.manage`), while the setting `launch.opening_entries_open`
  is on. The page's "Close opening entries" turns it off after go live; "Reopen" turns it back on.
- **An entry sets up treatment as usual:** the patient (a mobile already on file lists its patients
  first, as Add patient does), an episode at the centre walked to Active, and an **opening
  package** with the sessions left and the expiry entered: no package type, bill or payment. Its
  reschedules follow the per 10 sessions rule of a bought package, and its expiry reminder is
  queued the same way.
- **No consultation or plan:** session 1's baseline asks for nothing, the phase stepper says the
  phases start once a consultation names the region, and no 6 week review is booked (the job finds
  no signed plan). A consultant sees them when the clinic books a consultation.
- **Numbering starts again from launch:** the first session here is "Session 1"; the package meter
  shows what is left.
- **Booking:** the desk books each Session as usual. A Session or Zero Gravity Treadmill visit
  booked without an episode joins the patient's only open (Active or Under review) episode, for
  every patient; with none, or more than one, it stays as booked. Then it checks in, starts (the gate
  reads the Active episode) and closes, using the opening package.
- **Corrections:** the physio, sessions left and expiry, until the opening package is first used.
  The patient, episode and centre never change, and an entry is never removed. A correction keeps
  any reschedule already used as used (the allowance for the new size less those used), and a new
  expiry moves the queued reminder, or queues one again if it had already run. The guard locks the
  package before checking it is unused, so a session closing at the same moment either uses it
  first (and the correction is refused) or waits for the correction.
- **The forms** post without React's reset after an action, so a failed post keeps what was typed
  and chosen, and the physio shown after a correction is the one saved.

## How it is enforced

| Rule | Where |
| --- | --- |
| Super Admin only, entries open, physio with the Treats patients tick at the centre, an expiry not in the past | `apps/web/modules/opening-entries/services.ts` and `internal.opening_entry_guard` |
| The patient's own Active episode at the centre, with no consultation; stamps who and when | `internal.opening_entry_guard` |
| The opening package and its reminder, kept in step with a correction | `internal.opening_package` |
| A correction only while unused; never the patient, episode or centre; never deleted | `internal.opening_entry_guard`, `REVOKE DELETE` |
| A booked Session joins the only open episode | `internal.appointment_joins_open_episode` |
| Read with the patient's centre; written by the Super Admin; support read only; audited | `supabase/migrations/20261027163155_opening_entries_rules.sql` |

`package.bill_id`, `payment_id` and `package_type_id` are empty only on an opening package
(check `package_source`); nothing that reads packages joins them.

| Piece | Where |
| --- | --- |
| Schemas | `packages/schemas/src/opening-entries.ts`; setting `launch.opening_entries_open` |
| Tables | `opening_entry`, `package.opening_entry_id` (`20261027163109_opening_entries.sql`) |
| Reads and writes | `packages/db/src/opening-entries.ts` |
| Screens | `/app/opening-entries`; the patient record Overview's note and package meter |

## Tests

| Test | Covers |
| --- | --- |
| `packages/schemas/src/opening-entries.test.ts` | the fields and their messages |
| `apps/web/modules/opening-entries/services.test.ts` | the walk to Active and the entry; a mobile on file; refusals (closed, physio elsewhere, not the Super Admin, support); corrections until used; the switch |
| `packages/db/src/integration/opening-entries.integration.test.ts` | the opening package and its reminder; a correction moves both; a used reschedule stays used through corrections, and a corrected expiry queues a new reminder after the first ran; a signed session uses it; then no correction; refusals for a physio, the desk, a physio elsewhere, a past expiry, an episode not Active, closed entries, another patient, a delete; a booked Session joins the only open episode, not with none, two, or for a consultation |
| `apps/web/e2e/opening-entries.spec.ts` | 360 px and desktop: a refused post keeps what was typed and the physio chosen; the Super Admin enters and corrects a patient, changing the physio and back; the Overview's note and package meter; a booked Session shows "Session 1" with Start session for the physio |

**Negative checks:** without the "entries open" check the database test fails ("closed"); without
the package creation it fails (no opening package); recomputing reschedules without those used
fails it ("the physio only: still used").
