import 'server-only';
import {
  dischargeFeedbackTarget,
  episodeRecord,
  feedbackSubject,
  feedbackTarget,
  insertFeedback,
  liveDischargeFeedbackLink,
  liveFeedbackLink,
  type PatientLinkAccess,
} from '@clinic-mx/db';
import {
  feedbackSubmissionSchema,
  feedbackSurveyKeys,
  feedbackSurveys,
  postedFeedback,
  type FeedbackSurvey,
  type FeedbackSurveyKey,
} from '@clinic-mx/schemas';
import { z } from 'zod';
import { asPatient } from '../access/patient-db';
import { patientService, staffService, type ServiceTransaction } from '../access/service';
import {
  PatientLinkError,
  completePatientLink,
  issuePatientLink,
  patientLinkPath,
  verifyPatientLink,
  type IssuedLink,
} from '../patient-links/services';

/**
 * Feedback after the consultation (PAT-04) and at discharge (PAT-07), docs/runbooks/feedback.md.
 * Recommended defaults chosen under the user's standing approval, 28 October 2026 (DECISION PAT-04
 * and PAT-07). The patient answers the Blueprint's questions, Yes or No, with an optional comment
 * (and at discharge the 0 to 10 score), through a feedback link for the visit whose consultation
 * is signed, or for the discharged episode. Until WhatsApp sends them (ALT-06, OUT-11, WA-06), the
 * desk shows those links as QR codes on the plan and payment sheet.
 */

/** What the patient page shows for an opened feedback link: its survey while it is open. */
export async function loadFeedback(
  link: PatientLinkAccess,
  ip?: string,
): Promise<{ open: true; surveyKey: FeedbackSurveyKey; survey: FeedbackSurvey } | { open: false }> {
  const subject = await asPatient(link, (tx) => feedbackSubject(tx), ip);
  return subject
    ? { open: true, surveyKey: subject.surveyKey, survey: feedbackSurveys[subject.surveyKey] }
    : { open: false };
}

/** A feedback link to show at the desk: the working one, or a new one; or already answered. */
export type FeedbackQr = { received: true } | ({ received: false } & IssuedLink);

const episodeInput = z.object({ episodeId: z.guid({ error: 'That episode was not found.' }) });
const episodeCentre = async (input: z.output<typeof episodeInput>, tx: ServiceTransaction) => {
  const found = await episodeRecord(tx, input.episodeId);
  if (!found) throw new PatientLinkError('That episode was not found.');
  return { centreId: found.centreId };
};

/** The working link, signed again from its row. */
function shown(live: { id: string; expiresAt: Date }): FeedbackQr {
  const path = patientLinkPath({ id: live.id, purpose: 'feedback', expiresAt: live.expiresAt });
  if (!path) throw new PatientLinkError('Patient links are not set up (PATIENT_LINK_SECRET).');
  return { received: false, linkId: live.id, path, expiresAt: live.expiresAt };
}

/** Show the "Rate your visit" QR for the episode's newest signed consultation; audited. */
export const showFeedback = staffService({
  action: 'check_in.manage',
  input: episodeInput,
  target: episodeCentre,
  run: async (tx, input): Promise<FeedbackQr> => {
    const target = await feedbackTarget(tx, input.episodeId);
    if (!target) {
      throw new PatientLinkError('Feedback opens once the consultation is signed.');
    }
    if (target.received) return { received: true };
    const live = await liveFeedbackLink(tx, target.appointmentId);
    if (live) return shown(live);
    const issued = await issuePatientLink(tx, {
      patientId: target.patientId,
      appointmentId: target.appointmentId,
      purpose: 'feedback',
    });
    return { received: false, ...issued };
  },
});

/** Show the discharge feedback QR for a discharged episode (PAT-07); audited. */
export const showDischargeFeedback = staffService({
  action: 'check_in.manage',
  input: episodeInput,
  target: episodeCentre,
  run: async (tx, input): Promise<FeedbackQr> => {
    const target = await dischargeFeedbackTarget(tx, input.episodeId);
    if (!target) {
      throw new PatientLinkError('Discharge feedback opens once the episode is discharged.');
    }
    if (target.received) return { received: true };
    const live = await liveDischargeFeedbackLink(tx, input.episodeId);
    if (live) return shown(live);
    const issued = await issuePatientLink(tx, {
      patientId: target.patientId,
      episodeId: input.episodeId,
      purpose: 'feedback',
    });
    return { received: false, ...issued };
  },
});

/** The answers are in for a link that no longer takes them (answered, stopped or ended). */
export class FeedbackClosedError extends Error {}

type Answer = (link: PatientLinkAccess, raw: unknown, ip?: string) => Promise<void>;

/** The patient's write for each survey: the link's subject must be that survey's. */
const answers = Object.fromEntries(
  feedbackSurveyKeys.map((key) => [
    key,
    patientService({
      input: feedbackSubmissionSchema(key),
      run: async (tx, input, link) => {
        const subject = await feedbackSubject(tx);
        if (subject?.surveyKey !== key) {
          throw new FeedbackClosedError('This form is no longer open.');
        }
        await insertFeedback(tx, {
          linkId: link.id,
          subject,
          surveyVersion: feedbackSurveys[key].version,
          answers: input.answers,
          comment: input.comment,
          score: input.score,
        });
        await completePatientLink(tx, link);
      },
    }),
  ]),
) as Record<FeedbackSurveyKey, Answer>;

export type FeedbackResult =
  | { status: 'sent' }
  | { status: 'link' }
  | { status: 'invalid'; errors: Record<string, string>; values: Record<string, string> };

/**
 * Sends the answers posted for the feedback link behind `token`, for the survey the form names
 * (the link's own; another is refused); a used link is already sent.
 */
export async function submitFeedback(
  token: string,
  form: FormData,
  ip?: string,
): Promise<FeedbackResult> {
  const opened = await verifyPatientLink(token);
  if (opened.status === 'used' && opened.purpose === 'feedback') return { status: 'sent' };
  if (opened.status !== 'valid' || opened.link.purpose !== 'feedback') return { status: 'link' };
  const named = z.enum(feedbackSurveyKeys).safeParse(form.get('survey'));
  if (!named.success) return { status: 'link' };
  const survey = named.data;
  const posted = postedFeedback(survey, form) as {
    answers: Record<string, string | undefined>;
    comment?: string;
    score?: string;
  };
  const values = Object.fromEntries(
    Object.entries({ ...posted.answers, comment: posted.comment, score: posted.score }).flatMap(
      ([key, value]) => (value === undefined ? [] : [[key, value]]),
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
    await answers[survey](opened.link, posted, ip);
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
