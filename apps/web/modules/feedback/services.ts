import 'server-only';
import {
  episodeRecord,
  feedbackSubject,
  feedbackTarget,
  insertFeedback,
  liveFeedbackLink,
  type PatientLinkAccess,
} from '@clinic-mx/db';
import {
  feedbackSubmissionSchema,
  feedbackSurveys,
  postedFeedback,
  type FeedbackSurvey,
} from '@clinic-mx/schemas';
import { z } from 'zod';
import { asPatient } from '../access/patient-db';
import { patientService, staffService } from '../access/service';
import {
  PatientLinkError,
  completePatientLink,
  issuePatientLink,
  patientLinkPath,
  verifyPatientLink,
  type IssuedLink,
} from '../patient-links/services';

/**
 * Feedback after the consultation (PAT-04, docs/runbooks/feedback.md). Recommended defaults chosen
 * under the user's standing approval, 28 October 2026 (DECISION PAT-04). The patient answers the
 * Blueprint's four questions, Yes or No, with an optional comment, through a feedback link for
 * the visit whose consultation is signed. Until WhatsApp sends "Rate your visit" (ALT-06, WA-06),
 * the desk shows that link as a QR on the plan and payment sheet.
 */

const survey = 'post_consultation';

/** What the patient page shows for an opened feedback link: the survey while it is open. */
export async function loadFeedback(
  link: PatientLinkAccess,
  ip?: string,
): Promise<{ open: true; survey: FeedbackSurvey } | { open: false }> {
  const subject = await asPatient(link, (tx) => feedbackSubject(tx), ip);
  return subject ? { open: true, survey: feedbackSurveys[survey] } : { open: false };
}

/** The episode's "Rate your visit" link to show: the working one, or a new one; or received. */
export type FeedbackQr = { received: true } | ({ received: false } & IssuedLink);

/** Show the "Rate your visit" QR for the episode's newest signed consultation; audited. */
export const showFeedback = staffService({
  action: 'check_in.manage',
  input: z.object({ episodeId: z.guid({ error: 'That episode was not found.' }) }),
  target: async (input, tx) => {
    const found = await episodeRecord(tx, input.episodeId);
    if (!found) throw new PatientLinkError('That episode was not found.');
    return { centreId: found.centreId };
  },
  run: async (tx, input): Promise<FeedbackQr> => {
    const target = await feedbackTarget(tx, input.episodeId);
    if (!target) {
      throw new PatientLinkError('Feedback opens once the consultation is signed.');
    }
    if (target.received) return { received: true };
    const live = await liveFeedbackLink(tx, target.appointmentId);
    if (live) {
      const path = patientLinkPath({ id: live.id, purpose: 'feedback', expiresAt: live.expiresAt });
      if (!path) throw new PatientLinkError('Patient links are not set up (PATIENT_LINK_SECRET).');
      return { received: false, linkId: live.id, path, expiresAt: live.expiresAt };
    }
    const issued = await issuePatientLink(tx, {
      patientId: target.patientId,
      appointmentId: target.appointmentId,
      purpose: 'feedback',
    });
    return { received: false, ...issued };
  },
});

/** The answers are in for a link that no longer takes them (answered, stopped or ended). */
export class FeedbackClosedError extends Error {}

const answer = patientService({
  input: feedbackSubmissionSchema(survey),
  run: async (tx, input, link) => {
    const subject = await feedbackSubject(tx);
    if (!subject) throw new FeedbackClosedError('This form is no longer open.');
    await insertFeedback(tx, {
      linkId: link.id,
      subject,
      surveyKey: survey,
      surveyVersion: feedbackSurveys[survey].version,
      answers: input.answers,
      comment: input.comment,
    });
    await completePatientLink(tx, link);
  },
});

export type FeedbackResult =
  | { status: 'sent' }
  | { status: 'link' }
  | { status: 'invalid'; errors: Record<string, string>; values: Record<string, string> };

/** Sends the answers posted for the feedback link behind `token`; a used link is already sent. */
export async function submitFeedback(
  token: string,
  form: FormData,
  ip?: string,
): Promise<FeedbackResult> {
  const opened = await verifyPatientLink(token);
  if (opened.status === 'used' && opened.purpose === 'feedback') return { status: 'sent' };
  if (opened.status !== 'valid' || opened.link.purpose !== 'feedback') return { status: 'link' };
  const posted = postedFeedback(survey, form) as {
    answers: Record<string, string | undefined>;
    comment?: string;
  };
  const values = Object.fromEntries(
    Object.entries({ ...posted.answers, comment: posted.comment }).flatMap(([key, value]) =>
      value === undefined ? [] : [[key, value]],
    ),
  );
  const parsed = feedbackSubmissionSchema(survey).safeParse(posted);
  if (!parsed.success) {
    const errors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const field = issue.path.at(-1);
      if (typeof field === 'string' && !errors[field]) errors[field] = issue.message;
    }
    return { status: 'invalid', errors, values };
  }
  try {
    await answer(opened.link, posted, ip);
  } catch (error) {
    if (error instanceof FeedbackClosedError || error instanceof PatientLinkError) {
      return { status: 'link' };
    }
    // Sent twice at once (a double tap before the page loads): the other post's answers stand
    // (unique, 23505) or closed the link first (42501); the page then thanks the patient.
    const code =
      (error as { cause?: { code?: string } }).cause?.code ?? (error as { code?: string }).code;
    if (code === '23505' || code === '42501') return { status: 'link' };
    throw error;
  }
  return { status: 'sent' };
}
