import 'server-only';
import {
  alertForMessage,
  appointmentForMessage,
  completePatientLinkRow,
  consultationForMessage,
  episodeForMessage,
  feedbackSubjectOfLink,
  firstTreatmentAnswered,
  followUpDue,
  insertFeedback,
  invoiceFacts,
  liveDischargeFeedbackLink,
  liveFeedbackLink,
  liveMessageLink,
  liveMyPlanLink,
  messagePatient,
  newerOpenEpisode,
  newestDocument,
  packageForMessage,
  planSeriesForMessage,
  queueMessageOnce,
  type DbOrTransaction,
} from '@clinic-mx/db';
import {
  FIRST_TREATMENT_ANSWER_KEY,
  FOLLOW_UP_ANSWER_KEY,
  FOLLOW_UP_INTERVAL_KEY,
  TEMPLATE_LANGUAGE,
  checkAnswers,
  documentTime,
  firstName,
  firstTreatmentCheck,
  followUpCheck,
  formatRupees,
  istDate,
  messageTemplate,
  packageState,
  type CheckTemplate,
  type MessageTemplateKey,
  type TemplateParameters,
} from '@clinic-mx/schemas';
import { z } from 'zod';
import { systemService } from '../access/service';
import { issuePatientLink, patientLinkPath } from '../patient-links/services';
import { flowDate } from './booking-flow';

/**
 * The clinic's WhatsApp messages queued by the database (WA-06, part 1): each job's sender checks
 * the message is still due, then queues the template for the patient's number, once per job (its
 * key is the message's `source_key`). The send job then sends the newest version Meta approved,
 * or records it as Not sent. A check's message (the first treatment check, a follow up) stands for
 * a patient link, so a tap on its reply button is recorded as that link's answer
 * (`recordCheckAnswer`). Written as `system:whatsapp`; nothing of a message is logged.
 * Decisions (user, 30 October 2026): docs/runbooks/whatsapp-templates.md.
 */

export type SendOutcome =
  | 'queued'
  /** Queued before by this job (it ran again). */
  | 'already_queued'
  /** No longer due, with why. */
  | `skipped:${string}`;

/** Queues `key` for the patient, once for `sourceKey`, with its variables. */
async function queueFor<K extends MessageTemplateKey>(
  tx: DbOrTransaction,
  values: {
    key: K;
    patientId: string;
    sourceKey: string;
    variables: (name: string) => TemplateParameters<K>;
    patientLinkId?: string;
  },
): Promise<SendOutcome> {
  const patient = await messagePatient(tx, values.patientId);
  if (!patient) return 'skipped:no patient';
  const id = await queueMessageOnce(tx, {
    patientId: patient.id,
    toPhone: patient.phone,
    kind: 'template',
    templateKey: values.key,
    templateVersion: messageTemplate(values.key).version,
    language: TEMPLATE_LANGUAGE,
    variables: values.variables(firstName(patient.name)),
    createdBy: 'system:whatsapp',
    patientLinkId: values.patientLinkId ?? null,
    sourceKey: values.sourceKey,
  });
  return id ? 'queued' : 'already_queued';
}

/** The token at the end of a link's page, `/p/<token>`: what a template's link button carries. */
function tokenOf(path: string): string {
  return path.slice('/p/'.length);
}

/**
 * A working link of the patient's, else a new one; the token their message's button carries.
 * Reused first: a new My plan link stops the patient's older ones.
 */
async function linkToken(
  tx: DbOrTransaction,
  live: { id: string; expiresAt: Date } | undefined,
  issue: Parameters<typeof issuePatientLink>[1] & {
    purpose: 'my_plan' | 'feedback';
  },
): Promise<string> {
  const path = live && patientLinkPath({ ...live, purpose: issue.purpose });
  return tokenOf(path || (await issuePatientLink(tx, issue)).path);
}

/** The PDF a message carries is made by its own job: until it is, this one waits and retries. */
export class DocumentNotReadyError extends Error {
  override name = 'DocumentNotReadyError';
}

/** A working link the patient may already hold for the episode, else a new one. */
async function episodeLink(
  tx: DbOrTransaction,
  values: { patientId: string; episodeId: string; purpose: 'follow_up' | 'review' },
): Promise<{ id: string; token: string }> {
  const live = await liveMessageLink(tx, values.episodeId, values.purpose);
  const path = live && patientLinkPath({ ...live, purpose: values.purpose });
  if (live && path) return { id: live.id, token: tokenOf(path) };
  const issued = await issuePatientLink(tx, values);
  return { id: issued.linkId, token: tokenOf(issued.path) };
}

/** "2 weeks", "3 months": a follow up's interval as the message says it. */
export function followUpPeriod(count: number, unit: 'week' | 'month'): string {
  return `${String(count)} ${unit}${count === 1 ? '' : 's'}`;
}

const job = { sourceKey: z.string().min(1) };

/** The day after first treatment check (PAT-05): unless the desk's QR took the answer already. */
export const sendFirstTreatmentCheck = systemService({
  component: 'whatsapp',
  input: z.object({ ...job, appointmentId: z.guid(), episodeId: z.guid() }),
  run: async (tx, input): Promise<SendOutcome> => {
    if (await firstTreatmentAnswered(tx, input.episodeId)) return 'skipped:answered';
    const visit = await appointmentForMessage(tx, input.appointmentId);
    if (!visit) return 'skipped:no appointment';
    const live = await liveFeedbackLink(tx, input.appointmentId);
    const linkId =
      live?.id ??
      (
        await issuePatientLink(tx, {
          patientId: visit.patientId,
          appointmentId: input.appointmentId,
          purpose: 'feedback',
        })
      ).linkId;
    return queueFor(tx, {
      key: 'first_treatment_check',
      patientId: visit.patientId,
      sourceKey: input.sourceKey,
      patientLinkId: linkId,
      variables: (name) => ({ patient_name: name }),
    });
  },
});

/** The session 3 check (PAT-06): a message only, while the episode is still in treatment. */
export const sendSession3Check = systemService({
  component: 'whatsapp',
  input: z.object({ ...job, episodeId: z.guid() }),
  run: async (tx, input): Promise<SendOutcome> => {
    const episode = await episodeForMessage(tx, input.episodeId);
    if (!episode) return 'skipped:no episode';
    if (!['active', 'under_review'].includes(episode.status)) return 'skipped:not active';
    return queueFor(tx, {
      key: 'session_3_check',
      patientId: episode.patientId,
      sourceKey: input.sourceKey,
      variables: (name) => ({ patient_name: name }),
    });
  },
});

/**
 * A follow up after discharge (PAT-10): only while it is the one due and unanswered, and never
 * while the patient has a newer episode not yet discharged.
 */
export const sendFollowUpCheck = systemService({
  component: 'whatsapp',
  input: z.object({
    ...job,
    episodeId: z.guid(),
    count: z.int().positive(),
    unit: z.enum(['week', 'month']),
  }),
  run: async (tx, input): Promise<SendOutcome> => {
    const due = await followUpDue(tx, input.episodeId);
    if (due !== `${String(input.count)}_${input.unit}`) return 'skipped:not due';
    if (await newerOpenEpisode(tx, input.episodeId)) return 'skipped:newer episode';
    const episode = await episodeForMessage(tx, input.episodeId);
    if (!episode) return 'skipped:no episode';
    const link = await episodeLink(tx, {
      patientId: episode.patientId,
      episodeId: input.episodeId,
      purpose: 'follow_up',
    });
    return queueFor(tx, {
      key: 'follow_up_check',
      patientId: episode.patientId,
      sourceKey: input.sourceKey,
      patientLinkId: link.id,
      variables: (name) => ({
        patient_name: name,
        period: followUpPeriod(input.count, input.unit),
      }),
    });
  },
});

export class ClinicMessageError extends Error {
  override name = 'ClinicMessageError';
}

/**
 * The review request (PAT-09), to every discharged patient. Its button opens a `review` link that
 * redirects to the centre's Google review page; a centre without one fails the job, visibly.
 */
export const sendReviewRequest = systemService({
  component: 'whatsapp',
  input: z.object({ ...job, episodeId: z.guid() }),
  run: async (tx, input): Promise<SendOutcome> => {
    const episode = await episodeForMessage(tx, input.episodeId);
    if (!episode) return 'skipped:no episode';
    if (!episode.reviewLink) {
      throw new ClinicMessageError(
        `${episode.centreName} has no Google review link; add it on the centre to send review requests.`,
      );
    }
    const link = await episodeLink(tx, {
      patientId: episode.patientId,
      episodeId: input.episodeId,
      purpose: 'review',
    });
    return queueFor(tx, {
      key: 'review_request',
      patientId: episode.patientId,
      sourceKey: input.sourceKey,
      variables: (name) => ({ patient_name: name, review_link: link.token }),
    });
  },
});

/** The no show message (PRD J5.12): only while the appointment is still a no show. */
export const sendNoShow = systemService({
  component: 'whatsapp',
  input: z.object({ ...job, appointmentId: z.guid() }),
  run: async (tx, input): Promise<SendOutcome> => {
    const visit = await appointmentForMessage(tx, input.appointmentId);
    if (visit?.status !== 'no_show') return 'skipped:not a no show';
    return queueFor(tx, {
      key: 'no_show',
      patientId: visit.patientId,
      sourceKey: input.sourceKey,
      variables: (name) => ({
        patient_name: name,
        date: flowDate(istDate(visit.startsAt)),
        time: documentTime(visit.startsAt),
        clinic: visit.centreName,
      }),
    });
  },
});

/** The package expiry reminder (BIL-08): only for a package still active with sessions left. */
export const sendPackageExpiryReminder = systemService({
  component: 'whatsapp',
  input: z.object({ ...job, packageId: z.guid() }),
  run: async (tx, input): Promise<SendOutcome> => {
    const held = await packageForMessage(tx, input.packageId);
    if (!held || packageState(held, held.today) !== 'active') return 'skipped:not active';
    return queueFor(tx, {
      key: 'package_expiry_reminder',
      patientId: held.patientId,
      sourceKey: input.sourceKey,
      variables: (name) => ({
        patient_name: name,
        sessions_left: String(held.sessionsTotal - held.sessionsUsed),
        expiry_date: flowDate(held.validUntil),
      }),
    });
  },
});

/** The plan sessions list (SCH-11): the series' sessions still Booked or Confirmed. */
export const sendPlanSessionsList = systemService({
  component: 'whatsapp',
  input: z.object({ ...job, planBookingId: z.guid() }),
  run: async (tx, input): Promise<SendOutcome> => {
    const series = await planSeriesForMessage(tx, input.planBookingId);
    if (!series || series.starts.length === 0) return 'skipped:no sessions';
    return queueFor(tx, {
      key: 'plan_sessions_list',
      patientId: series.patientId,
      sourceKey: input.sourceKey,
      variables: (name) => ({
        patient_name: name,
        clinic: series.centreName,
        // Meta refuses line breaks in a variable.
        sessions: series.starts
          .map((start) => `${flowDate(istDate(start))} ${documentTime(start)}`)
          .join('; '),
      }),
    });
  },
});

/**
 * The safety advice after a red flag (PRD J3.10), holding text until the clinical lead signs off
 * the advice (DECISION WA-06), with the episode's centre's phone; a centre without one fails the
 * job, visibly.
 */
export const sendRedFlagSafetyAdvice = systemService({
  component: 'whatsapp',
  input: z.object({ ...job, alertId: z.guid() }),
  run: async (tx, input): Promise<SendOutcome> => {
    const alert = await alertForMessage(tx, input.alertId);
    const episode = alert && (await episodeForMessage(tx, alert.episodeId));
    if (!episode) return 'skipped:no alert';
    const phone = episode.centrePhone;
    if (!phone) {
      throw new ClinicMessageError(
        `${episode.centreName} has no phone number; add it on the centre to send the safety advice.`,
      );
    }
    return queueFor(tx, {
      key: 'red_flag_safety_advice',
      patientId: episode.patientId,
      sourceKey: input.sourceKey,
      variables: (name) => ({ patient_name: name, clinic_phone: phone }),
    });
  },
});

/**
 * The consultation summary (ALT-06, PRD J4.1), once when the consultation is signed: its PDF, with
 * "Open My plan" and "Rate your visit" (WA-06 part 2). Waits for the PDF.
 */
export const sendConsultationSummary = systemService({
  component: 'whatsapp',
  input: z.object({ ...job, consultationId: z.guid() }),
  run: async (tx, input): Promise<SendOutcome> => {
    const held = await consultationForMessage(tx, input.consultationId);
    if (held?.status !== 'signed') return 'skipped:not signed';
    const pdf = await newestDocument(tx, 'consultation_summary', input.consultationId);
    if (!pdf) throw new DocumentNotReadyError('The consultation summary is not made yet.');
    const plan = await linkToken(tx, await liveMyPlanLink(tx, held.episodeId), {
      patientId: held.patientId,
      episodeId: held.episodeId,
      purpose: 'my_plan',
    });
    const rating = await linkToken(tx, await liveFeedbackLink(tx, held.appointmentId), {
      patientId: held.patientId,
      appointmentId: held.appointmentId,
      purpose: 'feedback',
    });
    return queueFor(tx, {
      key: 'consultation_summary',
      patientId: held.patientId,
      sourceKey: input.sourceKey,
      variables: (name) => ({
        patient_name: name,
        plan_link: plan,
        feedback_link: rating,
        document_id: pdf.id,
        document_name: 'Consultation summary.pdf',
      }),
    });
  },
});

/**
 * The discharge report (OUT-11, PRD J6.7), once at discharge: its PDF, with "Give feedback" on the
 * discharge feedback link (WA-06 part 2). Waits for the PDF.
 */
export const sendDischargeReport = systemService({
  component: 'whatsapp',
  input: z.object({ ...job, episodeId: z.guid() }),
  run: async (tx, input): Promise<SendOutcome> => {
    const episode = await episodeForMessage(tx, input.episodeId);
    if (episode?.status !== 'discharged') return 'skipped:not discharged';
    const pdf = await newestDocument(tx, 'discharge_report', input.episodeId);
    if (!pdf) throw new DocumentNotReadyError('The discharge report is not made yet.');
    const feedbackLink = await linkToken(tx, await liveDischargeFeedbackLink(tx, input.episodeId), {
      patientId: episode.patientId,
      episodeId: input.episodeId,
      purpose: 'feedback',
    });
    return queueFor(tx, {
      key: 'discharge_report',
      patientId: episode.patientId,
      sourceKey: input.sourceKey,
      variables: (name) => ({
        patient_name: name,
        feedback_link: feedbackLink,
        document_id: pdf.id,
        document_name: 'Discharge report.pdf',
      }),
    });
  },
});

/**
 * The receipt (BIL-09, PRD J4.7), once per payment: the invoice and receipt PDF, never for a
 * payment undone since (WA-06 part 2). Waits for the PDF.
 */
export const sendReceipt = systemService({
  component: 'whatsapp',
  input: z.object({ ...job, paymentId: z.guid() }),
  run: async (tx, input): Promise<SendOutcome> => {
    const paid = await invoiceFacts(tx, input.paymentId);
    if (!paid) return 'skipped:no payment';
    if (paid.undone) return 'skipped:undone';
    const pdf = await newestDocument(tx, 'invoice_receipt', input.paymentId);
    if (!pdf) throw new DocumentNotReadyError('The receipt is not made yet.');
    return queueFor(tx, {
      key: 'receipt',
      patientId: paid.patientId,
      sourceKey: input.sourceKey,
      variables: (name) => ({
        patient_name: name,
        amount: formatRupees(paid.totalPaise),
        bill_number: paid.billNumber,
        document_id: pdf.id,
        document_name: `Receipt ${paid.invoiceNumber}.pdf`,
      }),
    });
  },
});

/**
 * A tap on a check's reply button (WA-06), recorded as its link's answer exactly as the link page
 * records it: once, for what the link answers now (the first treatment, the follow up due), the
 * link then used. The database gives Still sore and Injured again their tasks.
 */
export async function recordCheckAnswerIn(
  tx: DbOrTransaction,
  input: { linkId: string; template: CheckTemplate; answer: string },
): Promise<'recorded' | 'closed'> {
  if (!(checkAnswers[input.template] as readonly string[]).includes(input.answer)) {
    return 'closed';
  }
  const subject = await feedbackSubjectOfLink(tx, input.linkId);
  const followUp = input.template === 'follow_up_check';
  if (
    subject?.surveyKey !== (followUp ? 'follow_up' : 'first_treatment') ||
    (followUp && !subject.followUp)
  ) {
    return 'closed';
  }
  if (!(await completePatientLinkRow(tx, input.linkId))) return 'closed';
  await insertFeedback(tx, {
    linkId: input.linkId,
    subject,
    surveyVersion: followUp ? followUpCheck.version : firstTreatmentCheck.version,
    answers: followUp
      ? { [FOLLOW_UP_ANSWER_KEY]: input.answer, [FOLLOW_UP_INTERVAL_KEY]: subject.followUp ?? '' }
      : { [FIRST_TREATMENT_ANSWER_KEY]: input.answer },
    comment: null,
    score: null,
  });
  return 'recorded';
}
