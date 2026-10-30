# Patient feedback

PAT-04: "Post consultation feedback". Done when: four questions from the bundled message, with the
answers stored by centre and physio. PAT-07: "Discharge feedback". Done when: four questions plus a
0 to 10 recommendation score. Sources:
- PRD J4.1 (the bundled message with "Open My plan" and "Rate your visit") and M14;
- TAD `feedback`;
- Blueprint section 14 ("Example feedback questions, after the initial consultation");
- Frontend Specification, patient pages ("Feedback", "Thank you", 64 px Yes / No pairs);
- PRD J7.1 (discharge feedback: 4 questions plus a 0 to 10 recommendation score), the SOP's Net
  Promoter Score target.

These are recommended defaults chosen under the user's standing approval, 28 October 2026 (DECISION
PAT-04 and PAT-07).

## The questions

These are the Blueprint's four questions, word for word, as `post_consultation` version 1 in
`feedbackSurveys` (`packages/schemas/src/feedback.ts`):

1. Was your problem explained clearly?
2. Did you understand the proposed treatment plan?
3. Were your questions answered?
4. Were treatment options and charges explained transparently?

How they are answered:
- Each question is Yes or No. No document gives answer types; the wording asks Yes or No, and
  PAT-08 acts on a "No".
- There is one optional comment, of up to 1000 characters.
- No 0 to 10 score is asked here. That belongs to discharge (PAT-07, PRD J7.1).

The Blueprint calls these "example" questions. If the client changes the wording, that becomes
version 2. Each answer keeps the version it was asked in.

### At discharge (PAT-07)

The Blueprint's discharge questions, word for word, as `discharge` version 1:

1. Have you achieved the functional goals that matter most to you?
2. Do you understand how to continue your rehabilitation independently?
3. Were you satisfied with your clinical care and communication?
4. What could Movementology improve? This one asks for words, so it is the optional comment.

Then the 0 to 10 recommendation score, required, as 56 px numbers ("0 means not at all likely, 10
extremely likely"). No document words the question; "How likely are you to recommend
Movementology to a friend or family member?" stands in until the client gives theirs (DECISION
PAT-07, a new version then). The Net Promoter Score is promoters (9 or 10) less detractors (0 to 6)
as a share of the scores, rounded.

## How the patient answers

**The link.** It is a feedback link (`/p/<token>`, purpose `feedback`) tied to the consultation's
visit. It works for `links.feedback_days` (7) and takes one answer.

**When it opens.** The page shows the questions on one screen, then (at discharge) the score, then
an optional comment, then Send (the gold action). The link's own survey decides which. This
happens only while:
- the visit's consultation is signed, or (a link for the episode) the episode is discharged;
- nobody has answered it yet, by this link or another;
- the link works.

Otherwise the page says "This form is no longer open. Please ask the front desk."

**After sending.** The page thanks the patient: "Thank you. Your feedback has reached the clinic."

**Missing answers.** If an answer is missing, the patient sees "Please answer the questions marked
below." with the message under each one. Their other answers are kept.

**Without scripts.** The page works without scripts. It is a plain form post.

**Double tap.** If the patient sends twice at once, the second send lands on the thanks, not on an
error.

## How the desk gives it

The bundled WhatsApp message (`whatsapp.consultation_summary`) sends nothing until WA-06. Until then,
the plan and payment sheet (`/app/plans/<episode>`) has **Rate your visit** for those who check
patients in at the episode's centre.

"Show Rate your visit QR" works on the episode's newest signed consultation. It shows one of:
- the working link again;
- a new link;
- "Feedback received. Thank you." once the patient has answered.

For a discharged episode the sheet also has **Discharge feedback** ("Show discharge feedback QR"):
the episode's working link, a new one, or "Discharge feedback received. Thank you." The discharge
report's WhatsApp "Give feedback" (OUT-11) will send the same link.

The patient scans the QR with their phone camera. The shared `PatientLinkQr` component also draws
the My plan QR (PAT-01). The kiosk tablet can open feedback links too (IAM-10).

## Who reads the answers

The Centre Manager's **Feedback** screen (`/app/dashboard/feedback`) shows:
- Yes and No for each question over 30 days, 90 days or 12 months;
- the same counts by centre and by the physio who held the consultation;
- what patients wrote.

Who can read them:
- the Super Admin, for every centre;
- Centre Managers, for their own centres.

The desk, Finance and the physio named do not read answers. Nobody changes or removes an answer
(rule 5), and staff never write one.

## Service recovery (PAT-08)

PRD J7.2: "Negative answers or scores 0 to 6 create a service recovery task; complaints and adverse
events escalate to the clinical director within 24 hours." Blueprint section 14: "Negative feedback
should create a service-recovery task." Recommended defaults chosen under the user's standing
approval, 28 October 2026 (DECISION PAT-08):

- **When.** Any answer of No, after the consultation or at discharge, or a recommendation score at
  or below `feedback.recovery_score_max` (6).
- **The task.** A high `feedback.service_recovery` task for the centre's Centre Managers, made in the
  patient's own transaction (`internal.feedback_service_recovery`). Its details name the questions
  answered No and the score, never the patient; its card in Tasks lists those questions in their
  words and the score (`serviceRecoveryOf`). It is closed with a decision, like every task.
- **Escalation.** A complaint is service recovery not closed in time: a task still open after
  `feedback.escalate_hours` (24) gives the Clinical Director a task too
  (`feedback.service_recovery_director`, through the queued `feedback.recovery_escalate`). No
  Clinical Director role exists, so the Super Admin holds it, as for adverse events (DECISION SES-06).
  Adverse events already escalate at once.
- **Alerts.** The Centre Manager's Alerts count open service recovery tasks, linked to Tasks.

## Day after first treatment check (PAT-05)

PRD J5.6: "Day after first treatment check: Better, Same, Still sore. "Still sore" alerts the
physio." TAD jobs: next day, 10:00 AM. Every other choice is a recommended default chosen under
the user's standing approval, 29 October 2026 (DECISION PAT-05).

- **When:** signing the episode's session 1 queues `whatsapp.first_treatment_check` for the day
  after session 1's visit (`feedback.first_treatment_check_days`, 1) at 10:00 IST
  (`feedback.first_treatment_check_time`), or at once when the note is signed after that; once per
  episode (key per episode). Never for an opening entry's episode (SCH-13): those patients had
  their first treatment before launch (`internal.first_treatment_episode`). The job sends
  `first_treatment_check` by WhatsApp (WA-06) unless the desk's QR took the answer already; the
  message stands for the visit's feedback link (a working one, else a new one).
- **Until WhatsApp:** the desk shows "First treatment check" as a QR on the plan and payment
  sheet, for the episode's signed session 1's visit (a feedback link for that visit, working for
  `links.feedback_days`); before session 1 is signed it says the check opens then; once answered,
  "Answer received".
- **The question:** "How do you feel since your first treatment?" is a placeholder (DECISION
  PAT-05); the answers are the PRD's, Better, Same and Still sore, as three 64 px buttons, one tap
  sends it. Nothing else is asked or stored. **On WhatsApp (WA-06)** the same three answers are the
  message's reply buttons: a tap is recorded as the link's answer, the same row, once
  (`recordCheckAnswerIn`, through `internal.feedback_subject_of`), and the patient is thanked; a
  check answered already is thanked as such.
- **Still sore:** the episode's treating physio (the plan of care's), else the physio of session 1,
  gets a high task, "Still sore the day after the first treatment" (`review.still_sore`), counted
  with the open clinical reviews on the Centre Manager's Alerts ("New symptoms, adverse events,
  worsening and still sore to review"). It names no patient in its
  details. Never service recovery (PAT-08): that is for feedback about the service.
- **Better and Same:** recorded only.
- **Not built:** the amber tag beside the patient (the same gap as ALT-02's reviews), and a
  reminder when there is no answer.

## Session 3 check (PAT-06)

PRD J5.6: "Session 3 check message."; PRD M14; TAD jobs: "Session 3 check | After session 3 closes";
PRD J5.5: closing a session signs its note. Every other choice is a recommended default chosen under
the user's standing approval, 29 October 2026 (DECISION PAT-06).

- **What:** a message only, as the PRD names it ("Session 3 check message"). The Blueprint
  (section 14) does list four "After three sessions" example questions ("How do you feel compared
  with your first visit?", "Are you noticing any change in pain or function?", "Are you clear about
  your rehabilitation goals and home exercises?", "Is there anything we could improve about your
  care?") and says negative feedback should create a service recovery task. They are not adopted
  yet: the first has no answers to choose from in any document, and the PRD and TAD treat this one
  as a message. Open for the client (DECISION PAT-06): word the message, or adopt the questions
  as a survey (as PAT-04 and PAT-07 did) with their answers, which would then reach the manager's
  Feedback screen and service recovery. The `session_3_check` template keeps no buttons until then.
- **When:** signing the episode's session numbered `feedback.session_check_number` (3) queues
  `whatsapp.session_3_check` at once (the TAD gives no time), once per episode (key per episode),
  never for an opening entry's episode (numbering starts again at launch). It sends
  `session_3_check` by WhatsApp (WA-06), skipping an episode no longer Active or Under review.
- **Code:** `internal.session_3_check` and its trigger (`*_session_3_check_rules.sql`); the job stub
  in `apps/web/modules/jobs/handlers.ts`.
- **Tests:** `packages/db/src/integration/first-treatment-check.integration.test.ts` ("the session
  3 check"): queued at once on signing session 3, not sessions 1, 2 or 4, once per episode, never
  for an opening entry; the setting moves it. Disabling the trigger fails these tests.

## Review requests (PAT-09)

PRD J7.3: "Google review requests are sent to every discharged patient, never filtered by score";
PRD section 7: Fixed; Blueprint section 14: not conditional on a positive rating; TAD jobs:
"Discharge feedback and review request | Same day, then next day". Every other choice is a
recommended default chosen under the user's standing approval, 29 October 2026 (DECISION PAT-09).

- **Where the link lives:** each centre's Google review link, on its details
  (`docs/runbooks/centres.md`); the client gives the real links.
- **Who gets it:** every discharged episode, whatever its feedback, score, discharge reason or
  consultation. Discharging queues `whatsapp.review_request` in the same transaction (in
  `internal.episode_discharged_follow_up`), once per episode.
- **When:** the day after discharge (`feedback.review_request_days`, 1; the discharge report and
  its feedback go the same day) at 10:00 IST (`feedback.review_request_time`; the TAD gives no
  time), or at once when later. It sends `review_request` by WhatsApp (WA-06); its "Leave a review"
  button opens a `review` patient link (`links.review_days`, 30), which redirects to the episode's
  centre's Google review page. The job fails visibly when the centre has no link.
- **Until WhatsApp:** the plan and payment sheet of every discharged episode shows "Leave a review",
  the centre's link as a QR (a public link, so no patient link), for those who check in at its
  centre (`internal.review_link_target`); without a link it says so.
- **Tests:** `packages/schemas/src/centres.test.ts` (the link rule, optional);
  `packages/db/src/integration/review-request.integration.test.ts` (one request per discharged
  episode, the next day at 10:00 IST, with no consultation and as Lost to follow-up; the settings;
  the desk's link at its centre only, for a discharged episode). Moving the request inside the
  signed consultation condition fails this test. `apps/web/e2e/review-request.spec.ts` (360 px and
  desktop): the Super Admin sets the link (another site refused); the request queued at discharge;
  the desk's QR; the no-link notice.

## Follow ups after discharge and recurrence (PAT-10)

PRD J7.4: "Follow ups at 2 weeks, 6 weeks, 3 months and 12 months with Doing well, Some pain,
Injured again"; J7.5: ""Injured again" records a recurrence and alerts the consultant; recurrence
after discharge opens a new linked episode"; PRD section 7 and TAD jobs. Every other choice is a
recommended default chosen under the user's standing approval, 29 October 2026 (DECISION PAT-10).

- **When:** discharging any episode schedules (`follow_up_schedule`) and queues one
  `whatsapp.follow_up_check` per interval in `engagement.follow_ups_after_discharge` (2 weeks, 6
  weeks, 3 months, 12 months), each on that day after discharge (IST; a month at a month's end as
  the calendar allows) at `engagement.follow_up_time` (10:00 IST), keyed per episode and interval.
  Each follow up is open from its day until the next one's day (the last for `links.follow_up_days`,
  7 days); a missed one lapses. Each sends `follow_up_check` by WhatsApp (WA-06) only while its
  interval is the one due and unanswered, never to a patient with a newer episode not yet
  discharged; the message stands for the episode's follow up link, and a tap on Doing well, Some
  pain or Injured again is recorded as its answer, as on the link page. The schedule is fixed at discharge: changing the setting later moves
  nothing already scheduled.
- **How the patient answers:** a `follow_up` link for the episode (single use, `links.follow_up_days`,
  7 days; it opens on the clinic tablet too, as feedback links do) opens the follow up open now and
  unanswered, with the PRD's
  three answers as 64 px buttons and its period ("2 weeks after your treatment ended"); one tap
  sends it. The question is a placeholder for the client. Each interval is answered once, kept as
  `feedback` (survey `follow_up`, its interval in the answers) with the episode's centre and the
  consultant who discharged it. A feedback link for the episode still opens the discharge survey.
- **Until WhatsApp:** the plan and payment sheet of a discharged episode shows "Follow up": the due
  follow up as a QR, or when the next is due, or that all are past; for those who check in at its
  centre (`internal.follow_up_check_target`).
- **Injured again:** the answer is the recurrence record; the consultant who discharged the
  episode (the centre's Centre Managers when they are no longer active) gets a high task,
  "Injured again after discharge" (`review.injured_again`), counted with the open clinical reviews
  on the Centre Manager's Alerts, naming no patient in its details. It opens no episode by itself
  (SCH-14: the consultant links the new episode, `docs/runbooks/episodes.md`). Never service
  recovery.
- **Doing well and Some pain:** recorded only.
- **Tests:** `packages/schemas/src/feedback.test.ts` (the answers word for word, the periods);
  `apps/web/modules/feedback/services.test.ts` (the QR while one is due; the answer with its
  interval once); `packages/db/src/integration/follow-up.integration.test.ts` (four jobs on their
  days at 10:00 IST; not due, due and answered once; the discharge survey unchanged; Injured again's
  task for the consultant, else the managers, counted, never service recovery; a missed follow up
  lapsing; the desk at its centre, the link only while one is due; the schedule kept when the
  setting changes; only the due interval accepted, each once). Disabling `feedback_injured_again` fails this test.
  `apps/web/e2e/follow-up.spec.ts` (360 px and desktop): next due, the QR, the patient's tap, the
  thanks, the consultant's task.

## How it works

| Part | Where |
| --- | --- |
| The answers | `feedback` table (`*_feedback.sql`): survey key and version, the link, patient, episode, visit, consultation, centre, physio, answers, comment, when. One per link and one per consultation |
| What a link answers for | `internal.feedback_subject()`. A link for a visit gives its signed, unanswered consultation (`post_consultation`), centre and physio; a link for an episode gives the discharged, unanswered episode (`discharge`), its centre and the consultant who discharged it. It is SECURITY DEFINER and callable only by `clinic_patient` |
| At discharge | `score` (0 to 10, required at discharge, never after the consultation); one discharge answer per episode. `internal.discharge_feedback_target(episode)` and `internal.discharge_feedback_open(episode)` for the desk; `patient_link_discharge_feedback_read` and `_issue` for links of discharged episodes at their centres, for the episode's own patient |
| The patient's write | `feedback_patient_answer`: insert only, for exactly that subject, now. The patient reads nothing back. `patient_link_patient_complete_feedback` closes the link once its answer is in (`internal.feedback_submitted`) |
| The desk | `internal.feedback_target(episode)` returns the newest signed consultation's visit and patient and whether it was answered, for those who check in at its centre. `patient_link_feedback_read` and `_issue` let them read and issue feedback links for visits at their centres, for the visit's own patient, once signed and unanswered (`internal.feedback_open_for`) |
| Readers | `feedback_manager_read`: Super Admin and Centre Managers, at their centres. `feedbackResponses` reads with the physio's name through `internal.record_staff_name` |
| Services | `apps/web/modules/feedback/services.ts`: `loadFeedback`, `showFeedback` (`check_in.manage`, audited), `submitFeedback` (patient, audited as `patient:<id>`); actions in `actions.ts` |
| Pages | `app/(patient)/p/[token]/feedback-form.tsx`; `plans/[episodeId]/patient-qrs.tsx`; `dashboard/feedback/page.tsx` |
| First treatment check (PAT-05) | `survey_key = 'first_treatment'`, one per episode, its visit and physio, one answer of the three (`feedback_first_treatment`); `internal.feedback_subject()` gives a link for session 1's visit once signed and unanswered; `internal.first_treatment_check_target(episode)` and `internal.feedback_open_for` for the desk; `session_first_treatment_check` queues the job; `feedback_still_sore` makes the task; `first-treatment-form.tsx`, `showFirstTreatmentCheck`, `submitFirstTreatmentCheck` |

## Tests

| Test | Covers |
| --- | --- |
| `packages/schemas/src/feedback.test.ts` | Both surveys verbatim; Yes or No only; the comment; a missing, extra or other answer refused; the score a whole number from 0 to 10 as posted; counting; the Net Promoter Score |
| `apps/web/modules/feedback/services.test.ts` | The working link again or a new one; received; refusals before signing or discharge, elsewhere, for a physio; sending with the score; missing answers kept; used, other or closed links; a form naming another survey; a lost race |
| `apps/web/modules/reporting/manager.test.ts` | Counts by centre and by physio id; comments; the window; the Net Promoter Score overall and per group against the target |
| `packages/db/src/integration/feedback.integration.test.ts` | Covers: <ul><li>the answer for the consultation's centre and physio, audited as the patient;</li><li>no completion before the answer;</li><li>another subject, a second answer, a second link, a draft, a stopped or other link all refused;</li><li>no patient read;</li><li>Super Admin and Centre Manager reads by centre, with the desk, Finance and the physio refused;</li><li>nobody updates or deletes;</li><li>the desk issues only at its centre and only once signed.</li><li>At discharge: the answers and score for the episode's centre and discharging consultant; a score required; another subject, a second answer and an episode not yet discharged refused; the desk issues only at its centre, for the episode's own patient.</li></ul> |
| `packages/db/src/integration/first-treatment-check.integration.test.ts` | Signing session 1 queues one job for the next day at 10:00 IST, session 2 and a draft none; Better and Same once, no task; Still sore a high task for the treating physio (else session 1's physio), never service recovery, read by them and counted for the manager; an answer outside the three or with a comment refused; the desk's target at its centre once signed, and the link only then. Disabling `feedback_still_sore` fails this test |
| `apps/web/e2e/first-treatment-check.spec.ts` (360 px and desktop) | Closed before session 1 is signed; the desk QR; the patient's three buttons and one tap; the thanks; received at the desk; the physio's task |
| `apps/web/e2e/feedback.spec.ts` (360 px and desktop) | After the consultation and at discharge: the desk QR (discharge only once discharged); the patient's answers with the missing-answer and missing-score messages; the thanks; received at the desk; the Centre Manager's screen with the Net Promoter Score |

The database test also covers service recovery: a task for a No and none for all Yes, a score of
6 and not 7 at discharge, the escalation queued 24 hours on, the Alerts count, and the Clinical
Director's task once, never for a task closed in time. The end to end test sees the task in the
Centre Manager's Tasks and on Alerts.

Dropping the subject check from `feedback_patient_answer`, the discharged check from `internal.feedback_subject`, or the service recovery trigger makes the database test fail.
