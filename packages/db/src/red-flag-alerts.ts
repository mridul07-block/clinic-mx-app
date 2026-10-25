import type {
  AlertDisplay,
  EpisodeStatus,
  RedFlagAlertStatus,
  RedFlagTriage,
} from '@clinic-mx/schemas';
import { and, asc, desc, eq, inArray, like, ne, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { appointment, episode, patient, redFlagAlert, staffUser } from './schema';
import type { DbOrTransaction } from './versioned';

/**
 * Red flag alerts after they are raised (ALT-01): the alert list, the emergency banner, and the
 * lifecycle moves. Row level security limits reading to clinicians, the Super Admin and Centre
 * Managers at centres they see, and changing to clinicians; the lifecycle trigger allows only the
 * moves of packages/schemas/src/red-flag-alerts.ts and stamps who and when.
 */

const reviewer = alias(staffUser, 'alert_reviewer');
const referrer = alias(staffUser, 'alert_referrer');
const closer = alias(staffUser, 'alert_closer');

/** An alert as its card shows it: the rule, the patient and visit, and its lifecycle so far. */
export interface RedFlagAlertEntry {
  id: string;
  episodeId: string;
  episodeStatus: EpisodeStatus;
  appointmentId: string | null;
  centreId: string;
  patientName: string;
  startsAt: Date | null;
  ruleKey: string;
  name: string;
  triage: RedFlagTriage;
  display: AlertDisplay;
  action: string;
  signedOff: boolean;
  status: RedFlagAlertStatus;
  raisedAt: Date;
  reviewedBy: string | null;
  reviewedAt: Date | null;
  referredTo: string | null;
  referredBy: string | null;
  referredAt: Date | null;
  decision: string | null;
  closedBy: string | null;
  closedAt: Date | null;
}

function alertEntries(db: DbOrTransaction) {
  return db
    .select({
      id: redFlagAlert.id,
      episodeId: redFlagAlert.episodeId,
      episodeStatus: episode.status,
      appointmentId: redFlagAlert.appointmentId,
      centreId: episode.centreId,
      patientName: patient.name,
      startsAt: appointment.startsAt,
      ruleKey: redFlagAlert.ruleKey,
      name: redFlagAlert.name,
      triage: redFlagAlert.triage,
      display: redFlagAlert.display,
      action: redFlagAlert.action,
      signedOff: redFlagAlert.signedOff,
      status: redFlagAlert.status,
      raisedAt: redFlagAlert.raisedAt,
      reviewedBy: reviewer.name,
      reviewedAt: redFlagAlert.reviewedAt,
      referredTo: redFlagAlert.referredTo,
      referredBy: referrer.name,
      referredAt: redFlagAlert.referredAt,
      decision: redFlagAlert.decision,
      closedBy: closer.name,
      closedAt: redFlagAlert.closedAt,
    })
    .from(redFlagAlert)
    .innerJoin(episode, eq(episode.id, redFlagAlert.episodeId))
    .innerJoin(patient, eq(patient.id, episode.patientId))
    .leftJoin(appointment, eq(appointment.id, redFlagAlert.appointmentId))
    .leftJoin(reviewer, eq(reviewer.id, redFlagAlert.reviewedBy))
    .leftJoin(referrer, eq(referrer.id, redFlagAlert.referredBy))
    .leftJoin(closer, eq(closer.id, redFlagAlert.closedBy));
}

/** Every alert not yet closed that the signed in person reads, oldest first. */
export function openRedFlagAlerts(db: DbOrTransaction): Promise<RedFlagAlertEntry[]> {
  return alertEntries(db)
    .where(ne(redFlagAlert.status, 'closed'))
    .orderBy(asc(redFlagAlert.raisedAt), asc(redFlagAlert.id));
}

/** The most recently closed alerts the signed in person reads. */
export function recentlyClosedAlerts(
  db: DbOrTransaction,
  limit: number,
): Promise<RedFlagAlertEntry[]> {
  return alertEntries(db)
    .where(eq(redFlagAlert.status, 'closed'))
    .orderBy(desc(redFlagAlert.closedAt), desc(redFlagAlert.id))
    .limit(limit);
}

/** These alerts, as their cards show them (only those the signed in person reads). */
export function redFlagAlertsByIds(
  db: DbOrTransaction,
  ids: readonly string[],
): Promise<RedFlagAlertEntry[]> {
  if (ids.length === 0) return Promise.resolve([]);
  return alertEntries(db).where(inArray(redFlagAlert.id, [...ids]));
}

/** A Raised emergency, as the banner needs it: no rule, so anyone at the centre may see it. */
export interface OpenEmergency {
  alertId: string;
  episodeId: string;
  appointmentId: string | null;
  patientId: string;
  patientName: string;
  centreId: string;
  /** The visit it came with, for the calendar link. */
  startsAt: Date | null;
  raisedAt: Date;
}

/** The Raised emergencies at centres the signed in person sees (none for Finance or support). */
export async function openEmergencies(db: DbOrTransaction): Promise<OpenEmergency[]> {
  const rows = await db.execute<{
    alert_id: string;
    episode_id: string;
    appointment_id: string | null;
    patient_id: string;
    patient_name: string;
    centre_id: string;
    starts_at: string | Date | null;
    raised_at: string | Date;
  }>(
    sql`select o.alert_id, o.episode_id, o.appointment_id, o.patient_id, p.name as patient_name,
          o.centre_id, ap.starts_at, o.raised_at
        from internal.open_emergencies() o join public.patient p on p.id = o.patient_id
        left join public.appointment ap on ap.id = o.appointment_id
        order by o.raised_at, o.alert_id`,
  );
  return rows.map((row) => ({
    alertId: row.alert_id,
    episodeId: row.episode_id,
    appointmentId: row.appointment_id,
    patientId: row.patient_id,
    patientName: row.patient_name,
    centreId: row.centre_id,
    startsAt: row.starts_at === null ? null : new Date(row.starts_at),
    raisedAt: new Date(row.raised_at),
  }));
}

/** An alert locked for a lifecycle move, with its episode's centre. */
export interface AlertForUpdate {
  id: string;
  status: RedFlagAlertStatus;
  episodeId: string;
  centreId: string;
}

export async function alertForUpdate(
  tx: DbOrTransaction,
  alertId: string,
): Promise<AlertForUpdate | undefined> {
  const [row] = await tx
    .select({
      id: redFlagAlert.id,
      status: redFlagAlert.status,
      episodeId: redFlagAlert.episodeId,
      centreId: episode.centreId,
    })
    .from(redFlagAlert)
    .innerJoin(episode, eq(episode.id, redFlagAlert.episodeId))
    .where(eq(redFlagAlert.id, alertId))
    .for('update', { of: redFlagAlert });
  return row;
}

/** What a lifecycle move records; the trigger stamps the times. */
export type AlertMove =
  | { status: 'reviewed'; reviewedBy: string }
  | {
      status: 'referred';
      referredBy: string;
      referredTo: string;
      /** The referral letter's reason and question (ALT-07); the trigger needs both. */
      referralReason: string;
      referralQuestion: string;
    }
  | { status: 'closed'; closedBy: string; decision: string };

/** Moves an alert if it is still in `from`; whether it moved. */
export async function moveRedFlagAlert(
  tx: DbOrTransaction,
  alertId: string,
  from: RedFlagAlertStatus,
  move: AlertMove,
): Promise<boolean> {
  const moved = await tx
    .update(redFlagAlert)
    .set(move)
    .where(and(eq(redFlagAlert.id, alertId), eq(redFlagAlert.status, from)))
    .returning({ id: redFlagAlert.id });
  return moved.length > 0;
}

/**
 * A red flag the consultant found in the consultation (CLN-11), raised under row level security:
 * only for their own draft, with a `consultation.` rule key; returns its id. The consultant then
 * reviews it, and refers it unless it is Monitor with caution.
 */
export async function insertConsultationRedFlag(
  tx: DbOrTransaction,
  values: {
    episodeId: string;
    appointmentId: string;
    kbVersionId: string;
    name: string;
    triage: RedFlagTriage;
    display: AlertDisplay;
    action: string;
  },
): Promise<string> {
  const [row] = await tx
    .insert(redFlagAlert)
    .values({ ...values, ruleKey: `consultation.${crypto.randomUUID()}`, signedOff: true })
    .returning({ id: redFlagAlert.id });
  if (!row) throw new Error('The red flag was not recorded.');
  return row.id;
}

/** A red flag recorded in a consultation, as its Screening step lists it (CLN-11). */
export interface ConsultationRedFlagEntry {
  id: string;
  name: string;
  triage: RedFlagTriage;
  status: RedFlagAlertStatus;
  referredTo: string | null;
  raisedAt: Date;
}

/** The red flags recorded in a visit's consultation, oldest first. */
export function consultationRedFlags(
  db: DbOrTransaction,
  appointmentId: string,
): Promise<ConsultationRedFlagEntry[]> {
  return db
    .select({
      id: redFlagAlert.id,
      name: redFlagAlert.name,
      triage: redFlagAlert.triage,
      status: redFlagAlert.status,
      referredTo: redFlagAlert.referredTo,
      raisedAt: redFlagAlert.raisedAt,
    })
    .from(redFlagAlert)
    .where(
      and(
        eq(redFlagAlert.appointmentId, appointmentId),
        like(redFlagAlert.ruleKey, 'consultation.%'),
      ),
    )
    .orderBy(asc(redFlagAlert.raisedAt));
}
