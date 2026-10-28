# My plan

PAT-01: "My plan" page. Done when: the next session with Reschedule and Map, the exercises with
videos, a gold package meter, and the pain line with a sentence. Sources: PRD J5.7 and M10, Frontend
Specification (patient pages), TAD section 5 (the My plan link). Built in part: Reschedule waits for
WhatsApp (WA-05), the exercise videos for the video library (SET-07), and the plain words diagnosis
for AI-07. Recommended defaults chosen under the user's standing approval, 28 October 2026
(DECISION PAT-01).

## What the patient sees

A My plan link (`/p/<token>`, purpose `my_plan`, works for `links.my_plan_days`) opens, on their
phone and signed out:

- **Hello and the week:** "Week 3 of 6", counted in IST from the day the newest plan of care was
  made, never past its length ("Week 3" when the plan has no length).
- **Your next visit:** the next booked, confirmed or checked in visit of the episode still ahead,
  with the type, the physio and the centre, the centre's Map link, and "To change it, call the
  clinic" (a `tel:` link when the centre has a phone). No visit: "No visit is booked yet", and "Call
  the clinic to book". Links are 48 px tall.
- **Your exercises:** the plan's home programme (exercise, dose, note), without videos for now.
  Each has a 56 px "Mark done" button for today (PAT-02); once ticked it reads "Done today" and
  undoes the tick when tapped again. Under them, the week strip: the seven days of the plan's
  current week (counted from the day the plan was made, IST), done, missed or still to come.
- **Your package:** the package signing takes sessions from (active, oldest payment first, as
  `internal.session_sign`), or with none active the newest not cancelled; a gold meter ("4 of 10
  sessions used") with its last day and reschedules left, or "All sessions used", or "Expired on
  31 Aug 2026 with 6 sessions unused". Never a price.
- **Your pain during activity:** from signed sessions only, numbers only: a sentence as the Progress
  tab words it and a table of the three readings. Before any: "Your physio records it at each
  session."

A link whose episode no longer exists says "Your plan cannot be shown. Please ask the clinic." An
expired or stopped link says to send "My plan" on WhatsApp (IAM-09).

## How the desk gives it

Until WhatsApp sends it, the plan and payment sheet (`/app/plans/<episode>`) has **My plan for the
patient** for those who check patients in at the episode's centre, while the episode is not
discharged. "Show My plan QR" shows the episode's working link again (signed from its row), or
issues one, as a QR code drawn in the browser with the link's path and its last day. Issuing stops
the patient's older My plan links at any centre, as IAM-09 says, through
`internal.stop_older_my_plan_links` (the desk can neither read nor change those rows itself). The patient scans it with their phone camera. A plan
must exist; the tablet (kiosk) never opens My plan.

## Exercise ticks and adherence (PAT-02)

PRD J5.7: "Patients tick home exercises on My plan; adherence fills the next note." No document
defines a tick, adherence or its line, so these are recommended defaults chosen under the user's
standing approval, 28 October 2026 (DECISION PAT-02):

- **A tick:** one per row of the newest plan's home programme per IST day, for today only (the
  Frontend Specification's "today's exercises"), undone the same day. A tick names its plan
  version, the row's place and the exercise as it read; a plan changed under the page refuses the
  tick and the page says "Your plan has changed".
- **A day done:** any exercise ticked that day. Days, not exercises, are counted: doses are free
  text, so how many ticks a day "should" have is not known.
- **The session note's line:** in "Since last visit", "Home exercises ticked on My plan: 5 of 7
  days since the last session (21 Oct 2026 to 27 Oct 2026)": the IST days from the day after the
  visit of the episode's signed session before this one (its visit, however late its note was
  signed; or the day its first plan was made) to the day before this session, so today's ticks never move it during the visit. "No days since ..." when there
  are none; "not tracked" when the episode had no My plan link by then. Worked out live on a draft,
  kept in the note (`note.adherence`) by Close session, so the signed note never changes; the
  signed note on the patient record shows it as "Home exercises". The physio cannot type it.
- **Progress tab:** the week strip of the last seven days ending today.
- **Not tracked:** on both strips, days before the patient could tick (before the episode had both
  a plan and a My plan link, `internal.exercise_tracked_from`) show as "Not tracked", never missed,
  and are left out of the count.
- **Not built:** a measure across patients (DSH-06 says so), a low adherence alert (its threshold
  waits for the client, DECISION ALT-02), reminders (WhatsApp).

## How it works

| Part | Where |
| --- | --- |
| The page's content | `internal.my_plan()` (`20261028055556_my_plan.sql`): SECURITY DEFINER, callable only by `clinic_patient`; the link's own episode, only while the link works and the episode exists and is the link patient's; null otherwise |
| Whether there is a plan | `internal.episode_has_plan(episode)`: yes or no for those who check in at the episode's centre (the desk reads no plan of care) |
| Reading and issuing links | `patient_link_my_plan_read` and `patient_link_my_plan_issue`: those who check in, My plan links only, episodes at their centres (issued only for the episode's own patient) |
| Stopping older links | `internal.stop_older_my_plan_links(patient, keep)`: for a working My plan link of that patient which the caller may issue (those who check in at its centre, not support), or the server's own system transaction (the WhatsApp reissue); else 42501. `revokeMyPlanLinks` calls it |
| Readers | `myPlanView` (`packages/db/src/my-plan.ts`), `liveMyPlanLink` and `episodeHasPlan` (`my-plan-link.ts`) |
| Shape and words | `myPlanSchema`, `planWeek`, `packageLine` (`packages/schemas/src/my-plan.ts`); the pain sentence from `progress.ts` |
| Services | `loadMyPlan` (as the patient), `showMyPlan` (`check_in.manage` at the episode's centre; audited) in `apps/web/modules/patient-links/my-plan.ts`; `showMyPlanAction` |
| Pages | `app/(patient)/p/[token]/my-plan.tsx`; `plans/[episodeId]/patient-qrs.tsx` |
| Ticks | `exercise_tick` (`*_exercise_ticks.sql`): one per plan version, row and IST day, audited as the patient. `internal.exercise_tick_subject()` (the link's newest plan and today); the patient's insert, read and same-day delete policies; staff never write |
| Adherence | `internal.session_adherence(session)` and `internal.exercise_ticked_days(episode, from, to)` for those who read clinical records; `adherenceLine`, `weekStripDays`, `planWeekStart` (`packages/schemas/src/adherence.ts`); `tickMyPlanExercise` and `tickExerciseAction`; `loadSession`, `saveSessionNote` and `closeSession` in `modules/sessions/services.ts` |

## Tests

| Test | Covers |
| --- | --- |
| `packages/schemas/src/my-plan.test.ts` | The week in IST and its cap; the package line active, used up and expired; the shape, pain outside 0 to 10 refused |
| `apps/web/modules/patient-links/my-plan.test.ts` | Shows the working link again; issues one; refuses discharged, no plan, another centre, a physio |
| `packages/db/src/integration/my-plan.integration.test.ts` | Own episode only, no price, no table rows; nothing for a health form link, a revoked or expired link or one naming no episode; staff cannot call it; the HSR desk reads, issues and learns whether there is a plan, never reading the plan; the Koramangala desk and a physio refused; the desk's new link stops the older one, never for another centre, a physio or another patient; the package signing uses, then the next once used up; signed pain only |
| `apps/web/e2e/my-plan.spec.ts` (360 px and desktop) | The desk shows the QR, again the same link; the patient's page with the week, the next visit, the exercises, no price, no Reschedule; another centre's desk sees no QR. PAT-02: the patient ticks, undoes and ticks again with the week strip; the physio sees today on Progress and the line on the session note |
| `packages/schemas/src/adherence.test.ts` | The line's wording, including no days and not tracked; the week strip's states; the plan week in IST |
| `apps/web/modules/sessions/services.test.ts` | The draft shows the adherence now; a save never keeps one; Close session keeps it, then signs at the new version |

The database test also covers ticks: once a day, undone, shown on My plan; refused for another day,
row or wording, another episode, a revoked link and staff; yesterday kept; the days done since the
session before for the physio, and nothing for the desk.

Dropping the centre check from `internal.episode_has_plan`, or the today check from the tick
policy, fails the database test.
