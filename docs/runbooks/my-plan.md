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
| Pages | `app/(patient)/p/[token]/my-plan.tsx`; `plans/[episodeId]/my-plan-qr.tsx` |

## Tests

| Test | Covers |
| --- | --- |
| `packages/schemas/src/my-plan.test.ts` | The week in IST and its cap; the package line active, used up and expired; the shape, pain outside 0 to 10 refused |
| `apps/web/modules/patient-links/my-plan.test.ts` | Shows the working link again; issues one; refuses discharged, no plan, another centre, a physio |
| `packages/db/src/integration/my-plan.integration.test.ts` | Own episode only, no price, no table rows; nothing for a health form link, a revoked or expired link or one naming no episode; staff cannot call it; the HSR desk reads, issues and learns whether there is a plan, never reading the plan; the Koramangala desk and a physio refused; the desk's new link stops the older one, never for another centre, a physio or another patient; the package signing uses, then the next once used up; signed pain only |
| `apps/web/e2e/my-plan.spec.ts` (360 px and desktop) | The desk shows the QR, again the same link; the patient's page with the week, the next visit, the exercises, no price, no Reschedule; another centre's desk sees no QR |

Dropping the centre check from `internal.episode_has_plan` fails the database test.
