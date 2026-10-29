# Episodes

SCH-03, PRD M1, TAD sections 3 and 4.

The clinical episode is the backbone (rule 1, PRD G1). Appointments, consultations, plans, sessions,
outcomes and documents all belong to an episode. Bills and packages link to it but can never close
it.

## Decisions (user, 22 October 2026)

- **An episode opens at booking.** Booking a consultation for a new problem opens it as
  Intake pending; the health form submit moves it to Awaiting consultation.
- **Discharge reasons** come from the Blueprint (section 13):
  - Goals achieved;
  - Independent management;
  - Referred on;
  - Patient choice;
  - Financial or logistical barriers;
  - Lost to follow-up;
  - Other, with a note required.
- **The status buttons arrive with the tickets that own each change.** SCH-03 gives the machine,
  its guards and a read-only list on the patient page.

Also decided while building SCH-03:

- **Body region** uses the SET-10 `screening_region` list (back, neck, shoulder, elbow,
  wrist_hand, hip, knee, foot_ankle). It is optional until the health form records it, and it
  picks the regional red flag rules.
- **Status history is the audit trail.** Every insert and update is an audit event with the row
  before and after. There is no second history table.
- **Lost to follow up is marked by a person for now.** The automatic period is PRD decision #19,
  for the client before the discharge build; its job comes with OUT. Nothing closes an episode
  automatically (J5.12).

## Statuses

Intake pending, Awaiting consultation, On hold, Plan proposed, Active, Under review, Discharged
(with a reason), Lost to follow up.

## The machine (`packages/schemas/src/episodes.ts`)

Each change is one event. `episodeTransition(state, event, discharge?)` gives the next state or
the reason it is refused. It does no I/O.

| Event | From | To | Called by (later ticket) |
| --- | --- | --- | --- |
| `submit_intake` | Intake pending | Awaiting consultation | INT-10 health form submit |
| `propose_plan` | Awaiting consultation | Plan proposed | Signing (CLN-09; wired in BIL-01), unless On hold |
| `activate` | Plan proposed | Active | Paying for the chosen plan (BIL-06, PRD J4.7): the package's bill when a package is the newest choice, or the consultation fee when pay per session is (`internal.activate_if_paid`; `docs/runbooks/bills.md`) |
| `start_review` | Active | Under review | OUT review |
| `continue` | Under review | Active | OUT review |
| `hold` | Any open status except On hold and Lost | On hold, remembering where it paused | CLN-11 / ALT-01 (PRD J3.10) |
| `resume` | On hold | Where it paused | ALT-01 |
| `mark_lost` | Any open status except Lost | Lost to follow up, remembering where it paused | OUT |
| `return` | Lost to follow up | Where it paused | SCH-07 / OUT |
| `discharge` | Any open status | Discharged, with a reason and closing time | OUT |

The guards:

- **Discharged is final.** A recurrence opens a new episode linked to it (`linked_episode_id`,
  SCH-14).
- **Recovered needs treatment** (PRD J6.6: non attendance is never counted as recovered). Goals
  achieved and Independent management are allowed only from Active or Under review, or On hold
  paused from one of them.
- **Other needs a note.**
- **A hold then lost keeps the status from before the hold,** so a return goes back there.

## Two layers enforce it

- **The services.** `changeEpisodeStatus(tx, episodeId, event, discharge?)` in
  `apps/web/modules/episodes/services.ts` runs the machine. It then updates the row only if its
  status is still the one it read, so two changes at once cannot both win. Each later ticket calls
  it from its own `staffService`, which checks that ticket's permission.
- **The database.** The `episode_transition_guard` trigger holds the same table of allowed status
  pairs. It also refuses:
  - any change to a discharged episode;
  - a change of patient, centre or opening time;
  - a resume or return to anywhere but where the episode paused;
  - a recovered discharge without treatment.

  `episode_opens_pending` makes every new episode start as Intake pending. Check constraints tie
  Discharged to a closing time and reason, Other to a note, and the paused status to On hold and
  Lost to follow up.
- **A test keeps the two layers in step.** `episodes.integration.test.ts` tries every status pair
  against the trigger and compares the result with `allowedStatusPairs()`, so the two cannot
  drift apart.

`openEpisode` (`bookings.manage`, for a centre the person sees) opens an episode for SCH-07. A
recurrence may link only to a discharged episode of the same patient.

## Access

- **Read:** every signed in staff member, in every centre (records are shared, PRD J7.6).
- **Open:** the Super Admin, Centre Managers and the Front Desk, at a centre they see.
- **Move:** any signed in staff member, because payment, the front desk and clinicians all move
  episodes. The calling service checks the permission for its event.
- **Nobody deletes an episode,** and Velyx support is read only.

## Screen

The patient page (`/app/patients/[id]`) has an Episodes section, newest first. Each episode shows:

- its region, or "Region not recorded yet";
- a status tag (amber for On hold and Under review, which need attention; never red);
- its centre and when it opened;
- when it closed and why, once discharged.

With none: "No episodes yet. Booking a consultation opens one."

## Checking it

| Test | What it covers |
| --- | --- |
| `packages/schemas/src/episodes.test.ts` | Every status × event pair against a hand-written table; holds and losses return where they paused; recovered needs treatment; Other needs a note; discharged is final |
| `apps/web/modules/episodes/services.test.ts` | Opening by role and centre; recurrence links; a refused event writes nothing; a stale status is reported |
| `packages/db/src/integration/episodes.integration.test.ts` | Every status pair through the trigger matches the machine; the checks; changes from a stale status; reads and writes by role; no deletes; the audit history |
| `apps/web/e2e/episodes.spec.ts` | 360 px and desktop: the patient page lists an Active and a Discharged episode with reason and dates; the empty state; a physiotherapist reads the same list |

## Recurrences (SCH-14, 28 October 2026)

PRD J7.5 says a recurrence after discharge opens a new episode linked to the earlier one. Episodes
open when the health form is submitted, so the link is made later, by the clinician.

These are recommended defaults chosen under the user's standing approval of 28 October 2026. They
are recorded in the DECISION register as "SCH-14".

- **Where it is decided.** The consultation shows a **Previous episodes** panel listing the
  patient's discharged episodes, with each one's region, dates, discharge reason and diagnosis.
  - The consultant marks the current episode **Same problem again** against one of them, which links
    it (`linked_episode_id`).
  - **Not the same problem** removes the link.
  - Whether it is the same problem is the consultant's clinical call. No automatic rule is invented.
- **Who may link.** A consultant with the Treats patients tick (`consultant_records.write`), while
  the episode is open. It must be the consultation's own consultant, or a consultant at the
  episode's centre, as addenda are added. Everyone who reads the consultation sees the list.
- **The service** takes the consultation and finds its episode there; an episode id is never taken
  from the form.
- **The record.** The episode says "Recurrence of: <region>, closed <date>", and the earlier one says
  "Followed by a recurrence".
- **The database** (`internal.episode_link_guard`, migration `20261027231031_episode_link_rules.sql`):
  - A link names the same patient's discharged episode, and never the episode itself.
  - Once an episode is open, only an active consultant with the Treats tick changes its link. They
    must work at the episode's centre, or have written a consultation in the episode.
  - A discharged episode never changes (`episode_transition_guard`).
  - The audit trail records every change.
- **Injured again (PAT-10).** A follow up after discharge answered "Injured again" is the record of
  the recurrence: a `feedback` row (survey `follow_up`) against the discharged episode, which never
  changes, and a high task for the consultant who discharged it (`docs/runbooks/feedback.md`). It
  opens no episode by itself: the patient books, the health form opens the new episode, and the
  consultant links it here. The reinjury figure (DSH-01) is still to count these answers
  (`docs/runbooks/kpis.md`).

| Piece | Where |
| --- | --- |
| Reads and writes | `previousEpisodes`, `setEpisodeLink` in `packages/db/src/episodes.ts` |
| Service | `linkRecurrence` in `apps/web/modules/episodes/services.ts`; the panel's view in `modules/episodes/recurrence.ts` |
| Screens | `consultations/[consultationId]/previous-episodes.tsx`; `EpisodeHeading` on the patient record |

| Test | Covers |
| --- | --- |
| `apps/web/modules/episodes/services.test.ts` | Linking and unlinking; another patient's episode, one still open, a discharged current episode, and non-consultants are refused |
| `packages/db/src/integration/recurrence.integration.test.ts` | The previous episodes offered; a consultant links and unlinks, audited; another patient's episode, one not discharged, the episode itself, a physio without the Consultant tick, the desk, and a discharged episode are all refused, at insert too |
| `apps/web/e2e/recurrence.spec.ts` | At 360 px and on desktop: a consultant marks a returning patient's episode "Same problem again"; the record shows both lines; the link is taken back |

**Negative checks:** the database test fails without the same patient condition in the guard, and
again without its centre condition.

**Review:** an adversarial review confirmed 2 defects, both fixed with tests:

- **Any centre:** a consultant at any centre could change another centre's link. Linking is now
  limited to the consultation's own consultant or a consultant at the episode's centre, in the
  service and in the database.
- **Button names:** every row's button had the same accessible name. Each now names its episode,
  and the result is announced.
