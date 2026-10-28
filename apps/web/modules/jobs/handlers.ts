import {
  CONSULTATION_SUMMARY_JOB,
  CONSULTATION_SUMMARY_MESSAGE_JOB,
  DISCHARGE_REPORT_JOB,
  DISCHARGE_REPORT_MESSAGE_JOB,
  FIRST_TREATMENT_CHECK_JOB,
  INTAKE_SUBMITTED_JOB,
  INVOICE_JOB,
  KB_REPORT_JOB,
  LOST_TO_FOLLOW_UP_JOB,
  NO_SHOW_MESSAGE_JOB,
  PACKAGE_EXPIRY_REMINDER_JOB,
  PLAN_SESSIONS_LIST_JOB,
  RECEIPT_JOB,
  RED_FLAG_SAFETY_ADVICE_JOB,
  REVIEW_BOOK_JOB,
  REVIEW_OVERDUE_JOB,
  REFERRAL_LETTER_JOB,
  SERVICE_RECOVERY_ESCALATE_JOB,
  THINK_ABOUT_IT_FOLLOW_UP_JOB,
  THINK_ABOUT_IT_MESSAGE_JOB,
  UNSIGNED_NOTES_FLAG_JOB,
  defineJob,
  type JobHandlers,
} from '@clinic-mx/db';
import { z } from 'zod';
import { followUpThinkAboutIt } from '../billing/plan-choice';
import { generateConsultationSummary } from '../documents/consultation-summary';
import { generateDischargeReport } from '../documents/discharge-report';
import { generateInvoice } from '../documents/invoice';
import { generateReferralLetter } from '../documents/referral-letter';
import { runLostToFollowUpCheck } from '../episodes/lost-to-follow-up';
import { runServiceRecoveryEscalation } from '../feedback/service-recovery';
import { runReviewOverdueCheck } from '../episodes/review-overdue';
import { runKbReport } from '../ai/kb-report';
import { runPreparationSheet } from '../ai/preparation-sheet';
import { AI_PREPARATION_SHEET_JOB, processIntakeSubmission } from '../intake/pipeline';
import { runReviewBooking } from '../scheduling/review-booking';
import { runUnsignedNotesFlag } from '../tasks/unsigned-notes';

/**
 * Every job kind the tick can run (TAD section 8). Each ticket that adds a job adds its handler
 * here; handlers must be safe to run twice, because a job may run again after a crash.
 */
export const jobHandlers: JobHandlers = {
  /** Does nothing: proves the queue end to end on an environment (docs/runbooks/jobs.md). */
  'system.ping': { payload: z.object({}), run: () => Promise.resolve() },
  /** A submitted health form's pipeline (INT-10); a form already done is left as it is. */
  [INTAKE_SUBMITTED_JOB]: defineJob({
    payload: z.object({ appointmentId: z.guid() }),
    run: async ({ appointmentId }) => {
      await processIntakeSubmission(appointmentId);
    },
  }),
  /**
   * The AI preparation sheet's retry (AI-03; INT-10 queues it on submit, which also makes the sheet
   * straight away). Behind the AI gate (AI-09). While another run is still making the sheet it
   * fails, so the queue tries again after its backoff and takes the sheet over once that run's
   * claim has lapsed (`ai.sheet_retry_after_seconds`).
   */
  [AI_PREPARATION_SHEET_JOB]: defineJob({
    payload: z.object({ episodeId: z.guid() }),
    run: async ({ episodeId }, { db }) => {
      if ((await runPreparationSheet(db, episodeId)) === 'busy') {
        throw new Error('The preparation sheet is still being made by another run.');
      }
    },
  }),
  /**
   * The no show WhatsApp message (ALT-04, PRD J5.12), queued by the database when an appointment
   * becomes No show. Nothing is sent yet: the WhatsApp tickets (WA-01 onwards) fill this in, and
   * the sender must first check the appointment is still a no show (an undone one gets nothing),
   * then send the `no_show` template. Until then the job completes without sending.
   */
  /**
   * The day after first treatment check (PAT-05), queued by the database when an episode's session
   * 1 is signed, for the next day at 10:00 IST. Nothing is sent yet: WA-06 fills this in, and its
   * sender must first check the check is still unanswered (the desk QR may have taken it), then
   * send `first_treatment_check`. Until then the job completes without sending.
   */
  [FIRST_TREATMENT_CHECK_JOB]: defineJob({
    payload: z.object({ sessionId: z.guid(), episodeId: z.guid(), appointmentId: z.guid() }),
    run: () => Promise.resolve(),
  }),
  [NO_SHOW_MESSAGE_JOB]: defineJob({
    payload: z.object({ appointmentId: z.guid() }),
    run: () => Promise.resolve(),
  }),
  /**
   * The consultation summary (ALT-06), queued by the database when a consultation is signed and
   * when an addendum is added: the next version of its PDF. The job's own key marks the version it
   * makes, so a job that runs again makes nothing new.
   */
  [CONSULTATION_SUMMARY_JOB]: defineJob({
    payload: z.object({ consultationId: z.guid() }),
    run: async ({ consultationId }, { db, job }) => {
      await generateConsultationSummary(
        db,
        consultationId,
        job.idempotencyKey ?? [CONSULTATION_SUMMARY_JOB, job.id].join(':'),
      );
    },
  }),
  /**
   * The bundled message (ALT-06, PRD J4.1): the summary with "Open My plan" and "Rate your visit"
   * buttons, queued on signing. Nothing is sent yet: WA-06 fills this in, sending the newest
   * summary with the `consultation_summary` template once it exists (and retrying until it
   * does). Until then the job completes without sending.
   */
  [CONSULTATION_SUMMARY_MESSAGE_JOB]: defineJob({
    payload: z.object({ consultationId: z.guid() }),
    run: () => Promise.resolve(),
  }),
  /**
   * The plan sessions list (SCH-11, PRD J4.8), queued by the database once per series booked with
   * "Book plan sessions". Nothing is sent yet: WA-06 fills this in, sending the series' booked
   * appointments still Booked or Confirmed with the `plan_sessions_list` template. Until then the
   * job completes without sending.
   */
  /**
   * The unsigned notes flag (CLN-10), every night at 9:00 PM IST: it queues the next night, then
   * gives each centre's Centre Manager the notes still unsigned. A migration queued the first
   * night; running a night twice changes nothing.
   */
  /**
   * The monthly knowledge base report (AI-08; TAD: 1st of each month): the next month queued first,
   * then the month just ended built and sent to the Super Admin as a task, once.
   */
  [KB_REPORT_JOB]: defineJob({
    payload: z.object({ month: z.string() }),
    run: async ({ month }, { db }) => {
      await runKbReport(db, { month });
    },
  }),
  [UNSIGNED_NOTES_FLAG_JOB]: defineJob({
    payload: z.object({ date: z.iso.date() }),
    run: async ({ date }, { db }) => {
      await runUnsignedNotesFlag(db, { date });
    },
  }),
  /**
   * The discharge report (OUT-11), queued by the database once when an episode with a signed
   * consultation is discharged. The job's own key marks it, so a job that runs again makes nothing.
   */
  [DISCHARGE_REPORT_JOB]: defineJob({
    payload: z.object({ episodeId: z.guid() }),
    run: async ({ episodeId }, { db, job }) => {
      await generateDischargeReport(
        db,
        episodeId,
        job.idempotencyKey ?? [DISCHARGE_REPORT_JOB, job.id].join(':'),
      );
    },
  }),
  /**
   * The discharge report on WhatsApp (OUT-11, PRD J6.7), queued with it. Nothing is sent yet: the
   * WhatsApp tickets fill this in, sending the newest discharge report with its template once it
   * exists (and retrying until it does). Until then the job completes without sending.
   */
  [DISCHARGE_REPORT_MESSAGE_JOB]: defineJob({
    payload: z.object({ episodeId: z.guid() }),
    run: () => Promise.resolve(),
  }),
  /**
   * The lost to follow up check (OUT-10), every morning at 6:00 AM IST: it queues the next day,
   * then marks each episode nobody has attended for the setting's days, with nothing booked
   * ahead, Lost to follow up with a task for the consultant. Never a discharge. A migration queued
   * the first day; running a day twice changes nothing.
   */
  [LOST_TO_FOLLOW_UP_JOB]: defineJob({
    payload: z.object({ date: z.iso.date() }),
    run: async ({ date }, { db }) => {
      await runLostToFollowUpCheck(db, { date });
    },
  }),
  /**
   * The overdue 6 week review (ALT-02), every morning at 6:00 AM IST: it queues the next day, then
   * gives the consultant a task for each Active episode past its review date with no Review
   * attended or booked ahead and no final test, and closes open ones no longer due. A migration
   * queued the first day; running a day twice adds nothing.
   */
  [REVIEW_OVERDUE_JOB]: defineJob({
    payload: z.object({ date: z.iso.date() }),
    run: async ({ date }, { db }) => {
      await runReviewOverdueCheck(db, { date });
    },
  }),
  /**
   * The 6 week review (OUT-06), queued by the database once when the episode turns Active: the
   * Review with the consultant who signed the consultation at their first free time from the
   * plan's review date, or a task for the front desk. A review already booked is left as it is.
   */
  /**
   * Service recovery (PAT-08), queued with the task by the database for `feedback.escalate_hours`
   * after a No or a low score: a task still open gets the Clinical Director a task, once.
   */
  [SERVICE_RECOVERY_ESCALATE_JOB]: defineJob({
    payload: z.object({ taskId: z.guid() }),
    run: async ({ taskId }, { db }) => {
      await runServiceRecoveryEscalation(db, { taskId });
    },
  }),
  [REVIEW_BOOK_JOB]: defineJob({
    payload: z.object({ episodeId: z.guid() }),
    run: async ({ episodeId }, { db }) => {
      await runReviewBooking(db, { episodeId });
    },
  }),
  [PLAN_SESSIONS_LIST_JOB]: defineJob({
    payload: z.object({ planBookingId: z.guid() }),
    run: () => Promise.resolve(),
  }),
  /**
   * The referral letter (ALT-07), queued by the database when a red flag alert is referred, from
   * the consultation or the Alerts page. The job's own key marks the version it makes.
   */
  [REFERRAL_LETTER_JOB]: defineJob({
    payload: z.object({ alertId: z.guid() }),
    run: async ({ alertId }, { db, job }) => {
      await generateReferralLetter(
        db,
        alertId,
        job.idempotencyKey ?? [REFERRAL_LETTER_JOB, job.id].join(':'),
      );
    },
  }),
  /**
   * The safety advice after a red flag (CLN-11, PRD J3.10), queued with each referral and for
   * Monitor with caution found in the consultation. Nothing is sent yet: WA-06 fills this in with
   * the `red_flag_safety_advice` template once its advice is clinically signed off. Until then the
   * job completes without sending.
   */
  [RED_FLAG_SAFETY_ADVICE_JOB]: defineJob({
    payload: z.object({ alertId: z.guid() }),
    run: () => Promise.resolve(),
  }),
  /**
   * The "I'll think about it" follow up (BIL-02), queued by the database when the choice is
   * recorded, due at 10:00 AM IST on the second day (both settings): a call task for the front desk
   * and the WhatsApp nudge, unless the patient has chosen since or the episode has moved on. A
   * choice that already has its task gets nothing more.
   */
  [THINK_ABOUT_IT_FOLLOW_UP_JOB]: defineJob({
    payload: z.object({ choiceId: z.guid() }),
    run: async ({ choiceId }, { db }) => {
      await followUpThinkAboutIt(db, { choiceId });
    },
  }),
  /**
   * The "I'll think about it" WhatsApp nudge (BIL-02). Nothing is sent yet: the WhatsApp tickets
   * fill this in, and the sender must first check the choice is still the newest (a patient who
   * has chosen since gets nothing). Until then the job completes without sending.
   */
  [THINK_ABOUT_IT_MESSAGE_JOB]: defineJob({
    payload: z.object({ choiceId: z.guid() }),
    run: () => Promise.resolve(),
  }),
  /**
   * The invoice and receipt PDF (BIL-09), queued by the database when a payment is recorded, and
   * again when it is undone (that version prints it as cancelled). The job's own key marks the
   * version it makes.
   */
  [INVOICE_JOB]: defineJob({
    payload: z.object({ paymentId: z.guid() }),
    run: async ({ paymentId }, { db, job }) => {
      await generateInvoice(db, paymentId, job.idempotencyKey ?? [INVOICE_JOB, job.id].join(':'));
    },
  }),
  /**
   * The WhatsApp receipt (BIL-09, PRD J4.7), queued with each payment. Nothing is sent yet: the
   * WhatsApp tickets fill this in, and the sender must skip a payment since undone, then send the
   * newest invoice with the `receipt` template (retrying until it is made). Until then the job
   * completes without sending.
   */
  [RECEIPT_JOB]: defineJob({
    payload: z.object({ paymentId: z.guid() }),
    run: () => Promise.resolve(),
  }),
  /**
   * The package expiry reminder (BIL-08, PRD section 7), queued by the database when a package is
   * activated, `packages.expiry_reminder_days` before its last day at
   * `packages.expiry_reminder_time` IST. Nothing is sent yet: the WhatsApp tickets fill this in,
   * and the sender must check the package is still active with sessions left (not cancelled,
   * used up or expired), then send the `package_expiry_reminder` template with the sessions left
   * and the expiry date. Until then the job completes without sending.
   */
  [PACKAGE_EXPIRY_REMINDER_JOB]: defineJob({
    payload: z.object({ packageId: z.guid() }),
    run: () => Promise.resolve(),
  }),
};
