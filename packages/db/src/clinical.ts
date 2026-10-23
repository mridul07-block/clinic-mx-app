import type {
  AlertDisplay,
  HealthFormAnswer,
  NotificationKind,
  RedFlagTriage,
} from '@clinic-mx/schemas';
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import {
  appointment,
  consentRecord,
  intakeResponse,
  job,
  notification,
  patient,
  precaution,
  redFlagAlert,
  staffUser,
} from './schema';
import type { DbOrTransaction } from './versioned';

/**
 * The submit pipeline's reads and writes (INT-10, PRD J2.6). The pipeline runs as the system, in
 * one transaction per form; staff read alerts, precautions and their own notifications under row
 * level security.
 */

/** The job a patient's submit queues for the pipeline, keyed by the visit. */
export const INTAKE_SUBMITTED_JOB = 'intake.submitted';

/**
 * Queues the pipeline for the page's own visit, inside the patient's submit transaction: row
 * level security allows only this job, once the form is submitted. Nothing is read back.
 */
export async function enqueueIntakeSubmitted(
  tx: DbOrTransaction,
  appointmentId: string,
): Promise<void> {
  await tx.insert(job).values({
    kind: INTAKE_SUBMITTED_JOB,
    payload: { appointmentId },
    idempotencyKey: `${INTAKE_SUBMITTED_JOB}:${appointmentId}`,
  });
}

/** A submitted form with its visit, locked so two runs of the pipeline cannot both act. */
export interface SubmittedIntake {
  intakeResponseId: string;
  formVersion: string;
  answers: Record<string, HealthFormAnswer>;
  submittedAt: Date | null;
  /** Set once the pipeline has run for it. */
  episodeId: string | null;
  appointmentId: string;
  patientId: string;
  centreId: string;
  physioId: string;
  dateOfBirth: string | null;
}

export async function submittedIntake(
  tx: DbOrTransaction,
  appointmentId: string,
): Promise<SubmittedIntake | undefined> {
  const [row] = await tx
    .select({
      intakeResponseId: intakeResponse.id,
      formVersion: intakeResponse.formVersion,
      answers: intakeResponse.answers,
      submittedAt: intakeResponse.submittedAt,
      episodeId: intakeResponse.episodeId,
      appointmentId: appointment.id,
      patientId: appointment.patientId,
      centreId: appointment.centreId,
      physioId: appointment.physioId,
      dateOfBirth: patient.dateOfBirth,
    })
    .from(intakeResponse)
    .innerJoin(appointment, eq(appointment.id, intakeResponse.appointmentId))
    .innerJoin(patient, eq(patient.id, appointment.patientId))
    .where(eq(intakeResponse.appointmentId, appointmentId))
    .for('update', { of: intakeResponse });
  return row;
}

/** Ties the new episode to the visit, its form and the visit's Part A consent records. */
export async function linkIntakeEpisode(
  tx: DbOrTransaction,
  link: { appointmentId: string; intakeResponseId: string; episodeId: string },
): Promise<void> {
  await tx
    .update(appointment)
    .set({ episodeId: link.episodeId, updatedAt: sql`now()` })
    .where(eq(appointment.id, link.appointmentId));
  await tx
    .update(intakeResponse)
    .set({ episodeId: link.episodeId, updatedAt: sql`now()` })
    .where(eq(intakeResponse.id, link.intakeResponseId));
  await tx
    .update(consentRecord)
    .set({ episodeId: link.episodeId })
    .where(
      and(eq(consentRecord.appointmentId, link.appointmentId), isNull(consentRecord.episodeId)),
    );
}

export interface NewRedFlagAlert {
  episodeId: string;
  appointmentId: string;
  kbVersionId: string;
  ruleKey: string;
  name: string;
  triage: RedFlagTriage;
  display: AlertDisplay;
  action: string;
  signedOff: boolean;
}

export async function insertRedFlagAlerts(
  tx: DbOrTransaction,
  alerts: readonly NewRedFlagAlert[],
): Promise<void> {
  if (alerts.length === 0) return;
  await tx
    .insert(redFlagAlert)
    .values([...alerts])
    .onConflictDoNothing();
}

export interface NewPrecaution {
  episodeId: string;
  key: string;
  label: string;
  intakeResponseId: string | null;
  formVersion: string;
}

export async function insertPrecautions(
  tx: DbOrTransaction,
  precautions: readonly NewPrecaution[],
): Promise<void> {
  if (precautions.length === 0) return;
  await tx
    .insert(precaution)
    .values(precautions.map((row) => ({ ...row, source: 'health_form' as const })))
    .onConflictDoNothing();
}

export interface NewNotification {
  staffUserId: string;
  kind: NotificationKind;
  appointmentId: string;
  episodeId: string;
}

export async function insertNotifications(
  tx: DbOrTransaction,
  notifications: readonly NewNotification[],
): Promise<void> {
  if (notifications.length === 0) return;
  await tx
    .insert(notification)
    .values([...notifications])
    .onConflictDoNothing();
}

/** A notification as its list shows it, with the visit and, for a red flag, its alerts. */
export interface NotificationEntry {
  id: string;
  kind: NotificationKind;
  createdAt: Date;
  readAt: Date | null;
  appointmentId: string | null;
  startsAt: Date | null;
  centreId: string | null;
  patientName: string | null;
  /** The staff member who helped with the visit's health form (INT-09). */
  assistedByName: string | null;
  alerts: { name: string; triage: RedFlagTriage; signedOff: boolean }[];
}

const notificationHelper = alias(staffUser, 'notification_helper');

/** The signed in staff member's notifications, newest first (row level security: their own). */
export async function myNotifications(
  db: DbOrTransaction,
  limit = 50,
): Promise<NotificationEntry[]> {
  const rows = await db
    .select({
      id: notification.id,
      kind: notification.kind,
      createdAt: notification.createdAt,
      readAt: notification.readAt,
      appointmentId: notification.appointmentId,
      episodeId: notification.episodeId,
      startsAt: appointment.startsAt,
      centreId: appointment.centreId,
      patientName: patient.name,
      assistedByName: notificationHelper.name,
    })
    .from(notification)
    .leftJoin(appointment, eq(appointment.id, notification.appointmentId))
    .leftJoin(patient, eq(patient.id, appointment.patientId))
    .leftJoin(intakeResponse, eq(intakeResponse.appointmentId, notification.appointmentId))
    .leftJoin(notificationHelper, eq(notificationHelper.id, intakeResponse.assistedBy))
    // An emergency before the form it came with.
    .orderBy(desc(notification.createdAt), desc(notification.kind), desc(notification.id))
    .limit(limit);
  const episodes = [
    ...new Set(
      rows.flatMap((row) =>
        row.kind === 'red_flag_emergency' && row.episodeId ? [row.episodeId] : [],
      ),
    ),
  ];
  const alerts =
    episodes.length > 0
      ? await db
          .select({
            episodeId: redFlagAlert.episodeId,
            name: redFlagAlert.name,
            triage: redFlagAlert.triage,
            display: redFlagAlert.display,
            signedOff: redFlagAlert.signedOff,
          })
          .from(redFlagAlert)
          .where(inArray(redFlagAlert.episodeId, episodes))
          .orderBy(redFlagAlert.ruleKey)
      : [];
  return rows.map(({ episodeId, ...row }) => ({
    ...row,
    alerts:
      row.kind === 'red_flag_emergency'
        ? alerts
            .filter((alert) => alert.episodeId === episodeId && alert.display === 'emergency')
            .map(({ name, triage, signedOff }) => ({ name, triage, signedOff }))
        : [],
  }));
}

/** How many of the signed in staff member's notifications are unread. */
export async function unreadNotificationCount(db: DbOrTransaction): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(notification)
    .where(isNull(notification.readAt));
  return row?.count ?? 0;
}

/** Marks these of the signed in staff member's notifications read; how many were unread. */
export async function markNotificationsRead(
  tx: DbOrTransaction,
  ids: readonly string[],
): Promise<number> {
  if (ids.length === 0) return 0;
  const read = await tx
    .update(notification)
    .set({ readAt: sql`now()` })
    .where(and(inArray(notification.id, [...ids]), isNull(notification.readAt)))
    .returning({ id: notification.id });
  return read.length;
}
