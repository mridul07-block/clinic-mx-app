# No shows

What happens after the front desk confirms a no show (ALT-04, PRD J5.12: "WhatsApp message plus a
call task, counter updated. Two missed in a row add a clinical review task; the episode is never
auto closed"). Marking and undoing a no show, and its timing, are INT-11
(`docs/runbooks/calendar.md`, "Running late and no show").

Decisions (user, 24 October 2026):

- The clinical review task goes to the physio of the missed appointment, as a named person (an
  episode has no treating physio yet).
- The message is queued now and sent once WhatsApp exists (WA tickets).

## When an appointment becomes No show

All in the same transaction as the mark, done by the database trigger `no_show_follow_up`
(migration `no_show_workflow`), so no code path can skip it:

| What | Details |
| --- | --- |
| Counter | `booking_counter.no_shows` goes up (SCH-09's trigger `count_booking_change`); at `booking.self_booking_block_no_shows` self booking is blocked. |
| Call task | Kind `call.no_show` ("Call after a no show"), high, for the Front Desk at the appointment's centre: "Call about the missed 10:00 AM appointment on Fri 24 Oct" (IST), with the patient and episode. Any desk there can take it; it closes with a decision like any task (`docs/runbooks/tasks.md`). |
| Message | A `whatsapp.no_show` job with only `{appointmentId}`, once per appointment (idempotency key `whatsapp.no_show:<id>`). |
| Clinical review | When the patient has missed `clinical.no_show_review_after` (2) appointments in a row and has no open review: kind `review.no_shows` ("Clinical review: missed appointments"), high, for the physio of this appointment: "Clinical review: 2 missed appointments in a row", details `{appointmentId, missed}`. |

**In a row** means the patient's no shows since their last attended appointment (Checked in, In
progress or Completed), up to this one, at any centre. Cancelled, rescheduled and never marked
appointments are skipped. While a review is open, further misses add call tasks but no second
review. The episode is never changed.

Every task is written as the person marking (the audit trail shows them).

## When a no show is undone

The open tasks the no show raised (its call task, and the review if it raised one) close with
"Closed automatically: the no show was undone.", as the person undoing it (a role task nobody took
becomes theirs, so every closed task names who had it). The counter goes back down. The queued
message stays queued; its sender skips an appointment that is no longer a no show. Marking again
makes a new call task but never a second message.

## The message (until WhatsApp exists)

The handler for `whatsapp.no_show` (`apps/web/modules/jobs/handlers.ts`) completes without
sending. The WhatsApp tickets fill it in. The sender must:

- read the appointment and send nothing unless it is still a no show;
- send the `no_show` template (`packages/schemas/src/message-templates.ts`).

## Settings

| Key | Value | Meaning |
| --- | --- | --- |
| `clinical.no_show_review_after` | 2 | No shows in a row that give the physio a clinical review task |
| `day.no_show_allowed_minutes` | 25 | From when a no show can be marked (INT-11) |
| `booking.self_booking_block_no_shows` | 2 | No shows that block self booking (SCH-09) |

## Checking it

| Test | What it checks |
| --- | --- |
| `packages/db/src/integration/no-show.integration.test.ts` | As the HSR desk under row level security: the call task (high, at the centre, title in IST, audited as the desk), one queued message job, the count, the episode unchanged; another centre's desk does not see it. The second miss in a row gives the physio (not the desk) a review, once. An attended appointment starts the count again; a cancelled one is skipped. Undo closes the call and the review it raised, as the desk; marking again sends no second message. The count is read from the setting. |
| `apps/web/e2e/no-show.spec.ts` | 360 px and desktop. The confirm sheet says the desk gets a call task; the desk's Tasks shows it with the patient; after undo it is in Recently closed with the automatic decision. With an earlier miss, marking the next one gives the temporary physio "Clinical review: 2 missed appointments in a row", and not the desk. |

Negative check: with the count ignoring the last attended appointment, the "starts counting again"
database test failed (ALT-04).
