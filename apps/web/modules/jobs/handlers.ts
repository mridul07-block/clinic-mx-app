import {
  CONSULTATION_SUMMARY_JOB,
  CONSULTATION_SUMMARY_MESSAGE_JOB,
  INTAKE_SUBMITTED_JOB,
  INVOICE_JOB,
  NO_SHOW_MESSAGE_JOB,
  PACKAGE_EXPIRY_REMINDER_JOB,
  RECEIPT_JOB,
  RED_FLAG_SAFETY_ADVICE_JOB,
  REFERRAL_LETTER_JOB,
  THINK_ABOUT_IT_FOLLOW_UP_JOB,
  THINK_ABOUT_IT_MESSAGE_JOB,
  defineJob,
  type JobHandlers,
} from '@clinic-mx/db';
import { z } from 'zod';
import { followUpThinkAboutIt } from '../billing/plan-choice';
import { generateConsultationSummary } from '../documents/consultation-summary';
import { generateInvoice } from '../documents/invoice';
import { generateReferralLetter } from '../documents/referral-letter';
import { AI_PREPARATION_SHEET_JOB, processIntakeSubmission } from '../intake/pipeline';

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
   * The AI preparation sheet (INT-10 queues it on submit). Nothing runs yet: the AI gateway and
   * the sheet come with AI-01 to AI-03, and AI-09 switches them on after the blind test and the
   * legal check (PRD decision 23). Until then the job completes without calling any model.
   */
  [AI_PREPARATION_SHEET_JOB]: defineJob({
    payload: z.object({ episodeId: z.guid() }),
    run: () => Promise.resolve(),
  }),
  /**
   * The no show WhatsApp message (ALT-04, PRD J5.12), queued by the database when an appointment
   * becomes No show. Nothing is sent yet: the WhatsApp tickets (WA-01 onwards) fill this in, and
   * the sender must first check the appointment is still a no show (an undone one gets nothing),
   * then send the `no_show` template. Until then the job completes without sending.
   */
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
