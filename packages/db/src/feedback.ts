import { and, desc, eq, gt, gte, isNull, sql } from 'drizzle-orm';
import { centre, feedback, patientLink } from './schema';
import type { DbOrTransaction } from './versioned';

/**
 * Feedback after the consultation (PAT-04) and at discharge (PAT-07), docs/runbooks/feedback.md.
 * Patients write their answers through their link; the Super Admin and Centre Managers read them
 * at their centres; the desk only issues the link, through `internal.feedback_target` and
 * `internal.discharge_feedback_target`.
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

/**
 * The day after first treatment check (PAT-05): signing session 1 queues its WhatsApp message,
 * which waits for WA-06 to send it (the job keeps the session, episode and visit).
 */
export const FIRST_TREATMENT_CHECK_JOB = 'whatsapp.first_treatment_check';

/**
 * The session 3 check (PAT-06): signing the episode's session 3 queues its WhatsApp message at once;
 * a message only, which WA-06 words with the client and sends.
 */
export const SESSION_3_CHECK_JOB = 'whatsapp.session_3_check';

/** What the desk's first treatment check QR is for: the episode's signed session 1's visit. */
export async function firstTreatmentCheckTarget(
  db: DbOrTransaction,
  episodeId: string,
): Promise<FeedbackTarget | undefined> {
  const [row] = await db.execute<{
    appointment_id: string;
    patient_id: string;
    received: boolean;
  }>(sql`select * from internal.first_treatment_check_target(${episodeId}::uuid)`);
  if (!row) return undefined;
  return { appointmentId: row.appointment_id, patientId: row.patient_id, received: row.received };
}

/** What the patient's feedback link answers for, read as the patient; undefined once closed. */
export interface FeedbackSubject {
  surveyKey: 'post_consultation' | 'discharge' | 'first_treatment';
  patientId: string;
  episodeId: string;
  /** The visit (the consultation's, or the first treatment's), and the consultation; none at discharge. */
  appointmentId: string | null;
  consultationId: string | null;
  centreId: string;
  /** Who held the consultation or the first treatment, or who discharged the episode. */
  physioId: string | null;
}

export async function feedbackSubject(db: DbOrTransaction): Promise<FeedbackSubject | undefined> {
  const [row] = await db.execute<{
    survey_key: FeedbackSubject['surveyKey'];
    patient_id: string;
    episode_id: string;
    appointment_id: string | null;
    consultation_id: string | null;
    centre_id: string;
    physio_id: string | null;
  }>(sql`select * from internal.feedback_subject()`);
  if (!row) return undefined;
  return {
    surveyKey: row.survey_key,
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
    surveyVersion: number;
    answers: Record<string, string>;
    comment: string | null;
    score: number | null;
  },
): Promise<void> {
  const { subject } = values;
  await db.insert(feedback).values({
    surveyKey: subject.surveyKey,
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
    score: values.score,
  });
}

/** Whom a discharged episode's feedback QR is for, and whether it is answered (PAT-07). */
export async function dischargeFeedbackTarget(
  db: DbOrTransaction,
  episodeId: string,
): Promise<{ patientId: string; received: boolean } | undefined> {
  const [row] = await db.execute<{ patient_id: string; received: boolean }>(
    sql`select * from internal.discharge_feedback_target(${episodeId}::uuid)`,
  );
  return row ? { patientId: row.patient_id, received: row.received } : undefined;
}

/** The episode's working discharge feedback link (not stopped, used or ended), the newest. */
export async function liveDischargeFeedbackLink(
  db: DbOrTransaction,
  episodeId: string,
): Promise<{ id: string; expiresAt: Date } | undefined> {
  const [row] = await db
    .select({ id: patientLink.id, expiresAt: patientLink.expiresAt })
    .from(patientLink)
    .where(
      and(
        eq(patientLink.episodeId, episodeId),
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
  /** The 0 to 10 recommendation score, at discharge. */
  score: number | null;
}

/** One survey's answers since `from`, newest first, under the reader's RLS. */
export async function feedbackResponses(
  db: DbOrTransaction,
  from: Date,
  surveyKey: 'post_consultation' | 'discharge' = 'post_consultation',
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
      score: feedback.score,
    })
    .from(feedback)
    .innerJoin(centre, eq(centre.id, feedback.centreId))
    .where(and(eq(feedback.surveyKey, surveyKey), gte(feedback.submittedAt, from)))
    .orderBy(desc(feedback.submittedAt), desc(feedback.id));
}
