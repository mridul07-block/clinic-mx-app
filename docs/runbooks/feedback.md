# Feedback after the consultation

PAT-04: "Post consultation feedback". Done when: four questions from the bundled message, with the
answers stored by centre and physio. Sources:
- PRD J4.1 (the bundled message with "Open My plan" and "Rate your visit") and M14;
- TAD `feedback`;
- Blueprint section 14 ("Example feedback questions, after the initial consultation");
- Frontend Specification, patient pages ("Feedback", "Thank you", 64 px Yes / No pairs).

These are recommended defaults chosen under the user's standing approval, 28 October 2026 (DECISION
PAT-04).

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

## How the patient answers

**The link.** It is a feedback link (`/p/<token>`, purpose `feedback`) tied to the consultation's
visit. It works for `links.feedback_days` (7) and takes one answer.

**When it opens.** The page shows the four questions on one screen, then an optional comment, then
Send (the gold action). This happens only while:
- the visit's consultation is signed;
- nobody has answered it yet;
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

## How it works

| Part | Where |
| --- | --- |
| The answers | `feedback` table (`*_feedback.sql`): survey key and version, the link, patient, episode, visit, consultation, centre, physio, answers, comment, when. One per link and one per consultation |
| What a link answers for | `internal.feedback_subject()`. The patient's link gives its visit's signed, unanswered consultation, centre and physio. It is SECURITY DEFINER and callable only by `clinic_patient` |
| The patient's write | `feedback_patient_answer`: insert only, for exactly that subject, now. The patient reads nothing back. `patient_link_patient_complete_feedback` closes the link once its answer is in (`internal.feedback_submitted`) |
| The desk | `internal.feedback_target(episode)` returns the newest signed consultation's visit and patient and whether it was answered, for those who check in at its centre. `patient_link_feedback_read` and `_issue` let them read and issue feedback links for visits at their centres, for the visit's own patient, once signed and unanswered (`internal.feedback_open_for`) |
| Readers | `feedback_manager_read`: Super Admin and Centre Managers, at their centres. `feedbackResponses` reads with the physio's name through `internal.record_staff_name` |
| Services | `apps/web/modules/feedback/services.ts`: `loadFeedback`, `showFeedback` (`check_in.manage`, audited), `submitFeedback` (patient, audited as `patient:<id>`); actions in `actions.ts` |
| Pages | `app/(patient)/p/[token]/feedback-form.tsx`; `plans/[episodeId]/patient-qrs.tsx`; `dashboard/feedback/page.tsx` |

## Tests

| Test | Covers |
| --- | --- |
| `packages/schemas/src/feedback.test.ts` | The four questions verbatim; Yes or No only; the comment; a missing, extra or other answer refused; counting |
| `apps/web/modules/feedback/services.test.ts` | The working link again or a new one; received; refusals before signing, elsewhere, for a physio; sending; missing answers kept; used, other or closed links; a lost race |
| `apps/web/modules/reporting/manager.test.ts` | Counts by centre and by physio id; comments; the window |
| `packages/db/src/integration/feedback.integration.test.ts` | Covers: <ul><li>the answer for the consultation's centre and physio, audited as the patient;</li><li>no completion before the answer;</li><li>another subject, a second answer, a second link, a draft, a stopped or other link all refused;</li><li>no patient read;</li><li>Super Admin and Centre Manager reads by centre, with the desk, Finance and the physio refused;</li><li>nobody updates or deletes;</li><li>the desk issues only at its centre and only once signed.</li></ul> |
| `apps/web/e2e/feedback.spec.ts` (360 px and desktop) | The desk QR; the patient's four answers with the missing-answer message; the thanks; received at the desk; the Centre Manager's screen |

Dropping the subject check from `feedback_patient_answer` makes the database test fail.
