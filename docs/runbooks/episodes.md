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
