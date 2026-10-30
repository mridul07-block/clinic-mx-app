import {
  CONSULTATION_SUMMARY_JOB,
  CONSULTATION_SUMMARY_MESSAGE_JOB,
  DISCHARGE_REPORT_JOB,
  DISCHARGE_REPORT_MESSAGE_JOB,
  FIRST_TREATMENT_CHECK_JOB,
  FOLLOW_UP_CHECK_JOB,
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
  REVIEW_REQUEST_MESSAGE_JOB,
  SESSION_3_CHECK_JOB,
  REFERRAL_LETTER_JOB,
  SERVICE_RECOVERY_ESCALATE_JOB,
  THINK_ABOUT_IT_FOLLOW_UP_JOB,
  THINK_ABOUT_IT_MESSAGE_JOB,
  UNSIGNED_NOTES_FLAG_JOB,
  DAY_BEFORE_REMINDERS_JOB,
  MORNING_REMINDERS_JOB,
  defineJob,
  type JobHandlers,
} from '@clinic-mx/db';
import { z } from 'zod';
import { followUpThinkAboutIt } from '../billing/plan-choice';
import {
  sendConsultationSummary,
  sendDischargeReport,
  sendFirstTreatmentCheck,
  sendFollowUpCheck,
  sendNoShow,
  sendPackageExpiryReminder,
  sendPlanSessionsList,
  sendReceipt,
  sendRedFlagSafetyAdvice,
  sendReviewRequest,
  sendSession3Check,
} from '../messaging/clinic-messages';
import { runDayBeforeReminders, runMorningReminders } from '../messaging/reminders';
import { WHATSAPP_SEND_JOB, sendQueuedMessage } from '../messaging/send';
import { WHATSAPP_ROUTE_JOB, routeInboundMessage } from '../messaging/router';
import { WHATSAPP_EVENT_JOB, handleWhatsappEvent } from '../messaging/webhook';
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
  /**
   * Sends one WhatsApp message (WA-01), queued with its row by the `message_queue_send` trigger.
   * A failure Meta may get over is thrown, so the queue tries again with its backoff.
   */
  [WHATSAPP_SEND_JOB]: defineJob({
    payload: z.object({ messageId: z.guid() }),
    run: ({ messageId }, { db, job }) =>
      sendQueuedMessage(db, messageId, { attempt: job.attempts }),
  }),
  /** A webhook body from Meta (WA-02); usually handled already, straight after it came. */
  [WHATSAPP_EVENT_JOB]: defineJob({
    payload: z.object({ eventId: z.guid() }),
    run: async ({ eventId }, { db }) => {
      await handleWhatsappEvent(db, eventId);
    },
  }),
  /** A message sent to us (WA-03); usually routed already, straight after it came. */
  [WHATSAPP_ROUTE_JOB]: defineJob({
    payload: z.object({ messageId: z.guid() }),
    run: async ({ messageId }, { db }) => {
      await routeInboundMessage(db, messageId);
    },
  }),
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
   * becomes No show: the `no_show` template, only while the appointment is still a no show (an
   * undone one gets nothing; WA-06).
   */
  /**
   * The day after first treatment check (PAT-05), queued by the database when an episode's session
   * 1 is signed, for the next day at 10:00 IST: `first_treatment_check`, unless the desk QR took the answer
   * already (WA-06); a tap on its reply buttons is recorded as the answer.
   */
  [FIRST_TREATMENT_CHECK_JOB]: defineJob({
    payload: z.object({ sessionId: z.guid(), episodeId: z.guid(), appointmentId: z.guid() }),
    run: async ({ episodeId, appointmentId }, { db, job }) => {
      await sendFirstTreatmentCheck(db, {
        sourceKey: job.idempotencyKey ?? [job.kind, job.id].join(':'),
        episodeId,
        appointmentId,
      });
    },
  }),
  /**
   * The session 3 check (PAT-06), queued by the database when an episode's session 3 is signed, to
   * go at once. A message only: `session_3_check` with the patient's name (WA-06).
   */
  /**
   * The review request (PAT-09), queued by the database when any episode is discharged, for the
   * next day at 10:00 IST: to every discharged patient, never filtered by score. `review_request`,
   * whose button opens a review link to the centre's Google review page; it fails visibly, as a
   * background job failure, when the centre has none (WA-06).
   */
  /**
   * The follow ups after discharge (PAT-10), queued by the database at discharge, one per interval
   * of `engagement.follow_ups_after_discharge`, each on its day at 10:00 IST: `follow_up_check`
   * with the period, only while that interval is the one due and unanswered (the desk QR may have
   * taken it) and the patient has no newer episode not yet discharged (WA-06); a tap on its reply
   * buttons is recorded as the answer.
   */
  [FOLLOW_UP_CHECK_JOB]: defineJob({
    payload: z.object({
      episodeId: z.guid(),
      count: z.int().positive(),
      unit: z.enum(['week', 'month']),
    }),
    run: async (payload, { db, job }) => {
      await sendFollowUpCheck(db, {
        sourceKey: job.idempotencyKey ?? [job.kind, job.id].join(':'),
        ...payload,
      });
    },
  }),
  [REVIEW_REQUEST_MESSAGE_JOB]: defineJob({
    payload: z.object({ episodeId: z.guid() }),
    run: async ({ episodeId }, { db, job }) => {
      await sendReviewRequest(db, {
        sourceKey: job.idempotencyKey ?? [job.kind, job.id].join(':'),
        episodeId,
      });
    },
  }),
  [SESSION_3_CHECK_JOB]: defineJob({
    payload: z.object({ sessionId: z.guid(), episodeId: z.guid(), appointmentId: z.guid() }),
    run: async ({ episodeId }, { db, job }) => {
      await sendSession3Check(db, {
        sourceKey: job.idempotencyKey ?? [job.kind, job.id].join(':'),
        episodeId,
      });
    },
  }),
  [NO_SHOW_MESSAGE_JOB]: defineJob({
    payload: z.object({ appointmentId: z.guid() }),
    run: async ({ appointmentId }, { db, job }) => {
      await sendNoShow(db, {
        sourceKey: job.idempotencyKey ?? [job.kind, job.id].join(':'),
        appointmentId,
      });
    },
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
   * buttons, queued on signing: the newest summary with the `consultation_summary` template,
   * uploaded to Meta when sent; until the PDF is made the job fails and the queue tries again
   * (WA-06 part 2).
   */
  [CONSULTATION_SUMMARY_MESSAGE_JOB]: defineJob({
    payload: z.object({ consultationId: z.guid() }),
    run: async ({ consultationId }, { db, job }) => {
      await sendConsultationSummary(db, {
        sourceKey: job.idempotencyKey ?? [job.kind, job.id].join(':'),
        consultationId,
      });
    },
  }),
  /**
   * The plan sessions list (SCH-11, PRD J4.8), queued by the database once per series booked with
   * "Book plan sessions": the series' appointments still Booked or Confirmed, with the
   * `plan_sessions_list` template (WA-06).
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
   * The day before reminders (WA-08; PRD J1.6; TAD section 8): every evening at
   * `reminders.day_before_time` IST for the next day's appointments, with Confirm and Reschedule.
   * Each run queues the next evening's first.
   */
  [DAY_BEFORE_REMINDERS_JOB]: defineJob({
    payload: z.object({ date: z.iso.date() }),
    run: async ({ date }, { db }) => {
      await runDayBeforeReminders(db, { date });
    },
  }),
  /**
   * The reminders on the day (WA-08): every morning at `reminders.morning_time` IST (8:00 AM) for
   * the day's appointments not yet started, to every patient. Each run queues the next morning's.
   */
  [MORNING_REMINDERS_JOB]: defineJob({
    payload: z.object({ date: z.iso.date() }),
    run: async ({ date }, { db }) => {
      await runMorningReminders(db, { date });
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
   * The discharge report on WhatsApp (OUT-11, PRD J6.7), queued with it: the newest report with
   * the `discharge_report` template and its feedback link; until the PDF is made the job fails
   * and the queue tries again (WA-06 part 2).
   */
  [DISCHARGE_REPORT_MESSAGE_JOB]: defineJob({
    payload: z.object({ episodeId: z.guid() }),
    run: async ({ episodeId }, { db, job }) => {
      await sendDischargeReport(db, {
        sourceKey: job.idempotencyKey ?? [job.kind, job.id].join(':'),
        episodeId,
      });
    },
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
    run: async ({ planBookingId }, { db, job }) => {
      await sendPlanSessionsList(db, {
        sourceKey: job.idempotencyKey ?? [job.kind, job.id].join(':'),
        planBookingId,
      });
    },
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
   * Monitor with caution found in the consultation: the `red_flag_safety_advice` template, holding
   * text until the clinical lead signs off the advice (DECISION WA-06), with the centre's phone.
   */
  [RED_FLAG_SAFETY_ADVICE_JOB]: defineJob({
    payload: z.object({ alertId: z.guid() }),
    run: async ({ alertId }, { db, job }) => {
      await sendRedFlagSafetyAdvice(db, {
        sourceKey: job.idempotencyKey ?? [job.kind, job.id].join(':'),
        alertId,
      });
    },
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
   * The WhatsApp receipt (BIL-09, PRD J4.7), queued with each payment: the newest invoice with
   * the `receipt` template, never for a payment since undone; until the PDF is made the job fails
   * and the queue tries again (WA-06 part 2).
   */
  [RECEIPT_JOB]: defineJob({
    payload: z.object({ paymentId: z.guid() }),
    run: async ({ paymentId }, { db, job }) => {
      await sendReceipt(db, {
        sourceKey: job.idempotencyKey ?? [job.kind, job.id].join(':'),
        paymentId,
      });
    },
  }),
  /**
   * The package expiry reminder (BIL-08, PRD section 7), queued by the database when a package is
   * activated, `packages.expiry_reminder_days` before its last day at
   * `packages.expiry_reminder_time` IST: the `package_expiry_reminder` template with the sessions
   * left and the expiry date, only while the package is still active with sessions left (WA-06).
   */
  [PACKAGE_EXPIRY_REMINDER_JOB]: defineJob({
    payload: z.object({ packageId: z.guid() }),
    run: async ({ packageId }, { db, job }) => {
      await sendPackageExpiryReminder(db, {
        sourceKey: job.idempotencyKey ?? [job.kind, job.id].join(':'),
        packageId,
      });
    },
  }),
};
