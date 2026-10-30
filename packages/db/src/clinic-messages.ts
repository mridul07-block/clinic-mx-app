import { istDate } from '@clinic-mx/schemas';
import { and, asc, desc, eq, gt, inArray, isNull, ne, sql } from 'drizzle-orm';
import type { FeedbackSubject } from './feedback';
import {
  appointment,
  centre,
  episode,
  feedback,
  message,
  patient,
  patientLink,
  patientPackage,
  planBooking,
  redFlagAlert,
} from './schema';
import type { DbOrTransaction } from './versioned';

/**
 * What the clinic's WhatsApp messages need to know before they are queued (WA-06), read by the
 * server as `system:whatsapp` on the owner connection: whom to write to, and whether the message is
 * still due (the desk's QR may have taken the answer, the appointment may no longer be a no show).
 * The desk's own readers of these (`firstTreatmentCheckTarget` and the like) answer only someone
 * signed in at the centre, so the senders read here instead.
 */

export interface MessagePatient {
  id: string;
  name: string;
  phone: string;
}

export async function messagePatient(
  db: DbOrTransaction,
  patientId: string,
): Promise<MessagePatient | undefined> {
  const [row] = await db
    .select({ id: patient.id, name: patient.name, phone: patient.phone })
    .from(patient)
    .where(eq(patient.id, patientId));
  return row;
}

/** An episode's patient and centre, with the centre's name, phone and Google review link. */
export async function episodeForMessage(db: DbOrTransaction, episodeId: string) {
  const [row] = await db
    .select({
      patientId: episode.patientId,
      status: episode.status,
      createdAt: episode.createdAt,
      centreName: centre.name,
      centrePhone: centre.phone,
      reviewLink: centre.reviewLink,
    })
    .from(episode)
    .innerJoin(centre, eq(centre.id, episode.centreId))
    .where(eq(episode.id, episodeId));
  return row;
}

/** Whether the episode's first treatment check is answered (the desk's QR, or WhatsApp). */
export async function firstTreatmentAnswered(
  db: DbOrTransaction,
  episodeId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: feedback.id })
    .from(feedback)
    .where(and(eq(feedback.episodeId, episodeId), eq(feedback.surveyKey, 'first_treatment')))
    .limit(1);
  return Boolean(row);
}

/** The follow up due now for a discharged episode and unanswered ("2_week"), or null. */
export async function followUpDue(db: DbOrTransaction, episodeId: string): Promise<string | null> {
  const [row] = await db.execute<{ due: string | null }>(
    sql`select internal.follow_up_due(${episodeId}::uuid) as due`,
  );
  return row?.due ?? null;
}

/** Whether the patient has an episode opened after this one that is not discharged yet. */
export async function newerOpenEpisode(db: DbOrTransaction, episodeId: string): Promise<boolean> {
  const [row] = await db.execute<{ newer: boolean }>(sql`
    select exists (
      select 1 from ${episode} later join ${episode} this on this.id = ${episodeId}::uuid
      where later.patient_id = this.patient_id and later.id <> this.id
        and later.created_at > this.created_at and later.status <> 'discharged'
    ) as newer`);
  return row?.newer ?? false;
}

/** The episode's working link for `purpose` (not stopped, used or ended), the newest. */
export async function liveMessageLink(
  db: DbOrTransaction,
  episodeId: string,
  purpose: 'follow_up' | 'review',
): Promise<{ id: string; expiresAt: Date } | undefined> {
  const [row] = await db
    .select({ id: patientLink.id, expiresAt: patientLink.expiresAt })
    .from(patientLink)
    .where(
      and(
        eq(patientLink.episodeId, episodeId),
        eq(patientLink.purpose, purpose),
        isNull(patientLink.revokedAt),
        isNull(patientLink.completedAt),
        gt(patientLink.expiresAt, sql`now()`),
      ),
    )
    .orderBy(desc(patientLink.createdAt))
    .limit(1);
  return row;
}

/** An appointment with its centre's name, for the no show message. */
export async function appointmentForMessage(db: DbOrTransaction, appointmentId: string) {
  const [row] = await db
    .select({
      patientId: appointment.patientId,
      status: appointment.status,
      startsAt: appointment.startsAt,
      centreName: centre.name,
    })
    .from(appointment)
    .innerJoin(centre, eq(centre.id, appointment.centreId))
    .where(eq(appointment.id, appointmentId));
  return row;
}

/** A package with what its reminder needs; `today` decides whether it is still active. */
export async function packageForMessage(db: DbOrTransaction, packageId: string, now = new Date()) {
  const [row] = await db
    .select({
      patientId: patientPackage.patientId,
      sessionsTotal: patientPackage.sessionsTotal,
      sessionsUsed: patientPackage.sessionsUsed,
      validUntil: patientPackage.validUntil,
      cancelledAt: patientPackage.cancelledAt,
    })
    .from(patientPackage)
    .where(eq(patientPackage.id, packageId));
  return row ? { ...row, today: istDate(now) } : undefined;
}

/** A plan series' appointments still Booked or Confirmed, soonest first, with its centre. */
export async function planSeriesForMessage(db: DbOrTransaction, planBookingId: string) {
  const [series] = await db
    .select({ patientId: episode.patientId, centreName: centre.name })
    .from(planBooking)
    .innerJoin(episode, eq(episode.id, planBooking.episodeId))
    .innerJoin(centre, eq(centre.id, planBooking.centreId))
    .where(eq(planBooking.id, planBookingId));
  if (!series) return undefined;
  const starts = await db
    .select({ startsAt: appointment.startsAt })
    .from(appointment)
    .where(
      and(
        eq(appointment.planBookingId, planBookingId),
        inArray(appointment.status, ['booked', 'confirmed']),
      ),
    )
    .orderBy(asc(appointment.startsAt));
  return { ...series, starts: starts.map((row) => row.startsAt) };
}

/** A red flag alert's episode, for the safety advice. */
export async function alertForMessage(db: DbOrTransaction, alertId: string) {
  const [row] = await db
    .select({ episodeId: redFlagAlert.episodeId, status: redFlagAlert.status })
    .from(redFlagAlert)
    .where(eq(redFlagAlert.id, alertId));
  return row;
}

/**
 * The message of ours a reply answers (Meta gives our message's id as the reply's context): its
 * template and the patient link it stands for.
 */
export async function repliedMessage(db: DbOrTransaction, waMessageId: string) {
  const [row] = await db
    .select({
      id: message.id,
      templateKey: message.templateKey,
      patientId: message.patientId,
      patientLinkId: message.patientLinkId,
    })
    .from(message)
    .where(and(eq(message.waMessageId, waMessageId), ne(message.direction, 'inbound')));
  return row;
}

/** What a patient link answers for now (as `feedbackSubject` reads it for the link's own page). */
export async function feedbackSubjectOfLink(
  db: DbOrTransaction,
  linkId: string,
): Promise<FeedbackSubject | undefined> {
  const [row] = await db.execute<{
    survey_key: FeedbackSubject['surveyKey'];
    patient_id: string;
    episode_id: string;
    appointment_id: string | null;
    consultation_id: string | null;
    centre_id: string;
    physio_id: string | null;
    follow_up: string | null;
  }>(sql`select * from internal.feedback_subject_of(${linkId}::uuid)`);
  if (!row) return undefined;
  return {
    surveyKey: row.survey_key,
    patientId: row.patient_id,
    episodeId: row.episode_id,
    appointmentId: row.appointment_id,
    consultationId: row.consultation_id,
    centreId: row.centre_id,
    physioId: row.physio_id,
    followUp: row.follow_up,
  };
}
