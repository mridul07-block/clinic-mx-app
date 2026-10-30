import {
  changeableStatuses,
  istInstant,
  nextDayBeforeRun,
  nextMorningRun,
} from '@clinic-mx/schemas';
import { and, asc, eq, gt, gte, inArray, lt } from 'drizzle-orm';
import { enqueueJob } from './jobs/queue';
import { appointment, appointmentType, centre, message, patient, staffUser } from './schema';
import type { DbOrTransaction } from './versioned';

/**
 * The appointment reminders (WA-08; PRD J1.6; TAD section 8; docs/runbooks/whatsapp.md,
 * "Reminders"): two daily jobs keyed by the appointments' IST date, each queuing its next run
 * first, and the Confirm on the day before reminder.
 */

export const DAY_BEFORE_REMINDERS_JOB = 'whatsapp.day_before_reminders';
export const MORNING_REMINDERS_JOB = 'whatsapp.morning_reminders';

export type ReminderJob = typeof DAY_BEFORE_REMINDERS_JOB | typeof MORNING_REMINDERS_JOB;

/**
 * Queues the run after the one for `date` at `time` (IST, the setting as it is now); its own key
 * per date, so queuing twice adds nothing. The next run's date.
 */
export async function queueNextReminders(
  db: DbOrTransaction,
  kind: ReminderJob,
  date: string,
  time: string,
  now: Date = new Date(),
): Promise<string> {
  const next =
    kind === DAY_BEFORE_REMINDERS_JOB
      ? nextDayBeforeRun(now, date, time)
      : nextMorningRun(now, date, time);
  await enqueueJob(db, {
    kind,
    payload: { date: next.date },
    runAt: next.runAt,
    idempotencyKey: [kind, next.date].join(':'),
  });
  return next.date;
}

/** An appointment a reminder is sent for, with what the template says. */
export interface RemindableAppointment {
  id: string;
  patientId: string;
  phone: string;
  startsAt: Date;
  centreName: string;
  physioName: string;
  typeName: string;
}

/**
 * Every Booked or Confirmed appointment on the IST `date` not started by `now`, of every type and
 * every patient, soonest first.
 */
export function remindableAppointments(
  db: DbOrTransaction,
  date: string,
  now: Date,
): Promise<RemindableAppointment[]> {
  return db
    .select({
      id: appointment.id,
      patientId: appointment.patientId,
      phone: patient.phone,
      startsAt: appointment.startsAt,
      centreName: centre.name,
      physioName: staffUser.name,
      typeName: appointmentType.name,
    })
    .from(appointment)
    .innerJoin(patient, eq(patient.id, appointment.patientId))
    .innerJoin(centre, eq(centre.id, appointment.centreId))
    .innerJoin(staffUser, eq(staffUser.id, appointment.physioId))
    .innerJoin(appointmentType, eq(appointmentType.id, appointment.appointmentTypeId))
    .where(
      and(
        inArray(appointment.status, [...changeableStatuses]),
        gte(appointment.startsAt, istInstant(date, 0)),
        lt(appointment.startsAt, istInstant(date, 24 * 60)),
        gt(appointment.startsAt, now),
      ),
    )
    .orderBy(asc(appointment.startsAt), asc(appointment.number));
}

/** Whether a message was queued for this source already (a run that runs again). */
export async function messageQueuedFor(db: DbOrTransaction, sourceKey: string): Promise<boolean> {
  const [row] = await db
    .select({ id: message.id })
    .from(message)
    .where(eq(message.sourceKey, sourceKey));
  return row !== undefined;
}

/**
 * The day before reminder's Confirm (PRD J1.6): a Booked appointment becomes Confirmed, with when.
 * Returns what came of it: `confirmed` now, `already` Confirmed, or `changed` (moved, cancelled,
 * started, or gone).
 */
export async function confirmAppointment(
  tx: DbOrTransaction,
  appointmentId: string,
  now: Date,
): Promise<{ outcome: 'confirmed' | 'already' | 'changed'; startsAt?: Date; centreId?: string }> {
  const [row] = await tx
    .select({
      status: appointment.status,
      startsAt: appointment.startsAt,
      centreId: appointment.centreId,
    })
    .from(appointment)
    .where(eq(appointment.id, appointmentId))
    .for('update');
  if (!row) return { outcome: 'changed' };
  const { startsAt, centreId } = row;
  if (row.status === 'confirmed' && startsAt > now)
    return { outcome: 'already', startsAt, centreId };
  if (row.status !== 'booked' || startsAt <= now) return { outcome: 'changed', centreId };
  await tx
    .update(appointment)
    .set({ status: 'confirmed', confirmedAt: now, updatedAt: now })
    .where(eq(appointment.id, appointmentId));
  return { outcome: 'confirmed', startsAt, centreId };
}
