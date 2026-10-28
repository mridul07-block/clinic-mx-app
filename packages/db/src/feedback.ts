import { and, desc, eq, gt, gte, isNull, sql } from 'drizzle-orm';
import { centre, feedback, patientLink } from './schema';
import type { DbOrTransaction } from './versioned';

/**
 * Feedback after the consultation (PAT-04, docs/runbooks/feedback.md). Patients write their
 * answers through their link; the Super Admin and Centre Managers read them at their centres;
 * the desk only issues the link, through `internal.feedback_target`.
 */

/** What the desk's "Rate your visit" QR is for: the episode's newest signed consultation. */
export interface FeedbackTarget {
  appointmentId: string;
  patientId: string;
  /** Whether its feedback is already in. */
  received: boolean;
}

/** The episode's feedback target, for those who check in at its centre; undefined otherwise. */
export async function feedbackTarget(
  db: DbOrTransaction,
  episodeId: string,
): Promise<FeedbackTarget | undefined> {
  const [row] = await db.execute<{
    appointment_id: string;
    patient_id: string;
    received: boolean;
  }>(sql`select * from internal.feedback_target(${episodeId}::uuid)`);
  if (!row) return undefined;
  return { appointmentId: row.appointment_id, patientId: row.patient_id, received: row.received };
}

/** The visit's working feedback link (not stopped, used or ended), the newest. */
export async function liveFeedbackLink(
  db: DbOrTransaction,
  appointmentId: string,
): Promise<{ id: string; expiresAt: Date } | undefined> {
  const [row] = await db
    .select({ id: patientLink.id, expiresAt: patientLink.expiresAt })
    .from(patientLink)
    .where(
      and(
        eq(patientLink.appointmentId, appointmentId),
        eq(patientLink.purpose, 'feedback'),
        isNull(patientLink.revokedAt),
        isNull(patientLink.completedAt),
        gt(patientLink.expiresAt, sql`now()`),
      ),
    )
    .orderBy(desc(patientLink.createdAt))
    .limit(1);
  return row;
}

/** What the patient's feedback link answers for, read as the patient; undefined once closed. */
export interface FeedbackSubject {
  patientId: string;
  episodeId: string;
  appointmentId: string;
  consultationId: string;
  centreId: string;
  physioId: string;
}

export async function feedbackSubject(db: DbOrTransaction): Promise<FeedbackSubject | undefined> {
  const [row] = await db.execute<{
    patient_id: string;
    episode_id: string;
    appointment_id: string;
    consultation_id: string;
    centre_id: string;
    physio_id: string;
  }>(sql`select * from internal.feedback_subject()`);
  if (!row) return undefined;
  return {
    patientId: row.patient_id,
    episodeId: row.episode_id,
    appointmentId: row.appointment_id,
    consultationId: row.consultation_id,
    centreId: row.centre_id,
    physioId: row.physio_id,
  };
}

/** Records the patient's answers for the link's subject. The patient reads nothing back. */
export async function insertFeedback(
  db: DbOrTransaction,
  values: {
    linkId: string;
    subject: FeedbackSubject;
    surveyKey: 'post_consultation';
    surveyVersion: number;
    answers: Record<string, string>;
    comment: string | null;
  },
): Promise<void> {
  const { subject } = values;
  await db.insert(feedback).values({
    surveyKey: values.surveyKey,
    surveyVersion: values.surveyVersion,
    patientLinkId: values.linkId,
    patientId: subject.patientId,
    episodeId: subject.episodeId,
    appointmentId: subject.appointmentId,
    consultationId: subject.consultationId,
    centreId: subject.centreId,
    physioId: subject.physioId,
    answers: values.answers,
    comment: values.comment,
  });
}

/** One answered survey as managers read it. */
export interface FeedbackResponse {
  id: string;
  submittedAt: Date;
  surveyVersion: number;
  centreId: string;
  centreName: string;
  physioId: string | null;
  physioName: string;
  answers: Record<string, string>;
  comment: string | null;
}

/** The feedback after the consultation since `from`, newest first, under the reader's RLS. */
export async function feedbackResponses(
  db: DbOrTransaction,
  from: Date,
): Promise<FeedbackResponse[]> {
  return db
    .select({
      id: feedback.id,
      submittedAt: feedback.submittedAt,
      surveyVersion: feedback.surveyVersion,
      centreId: feedback.centreId,
      centreName: centre.name,
      physioId: feedback.physioId,
      // Through an internal function: whoever reads the feedback reads the physio's name.
      physioName: sql<string>`coalesce(internal.record_staff_name(${feedback.physioId}), '')`,
      answers: feedback.answers,
      comment: feedback.comment,
    })
    .from(feedback)
    .innerJoin(centre, eq(centre.id, feedback.centreId))
    .where(and(eq(feedback.surveyKey, 'post_consultation'), gte(feedback.submittedAt, from)))
    .orderBy(desc(feedback.submittedAt), desc(feedback.id));
}
