import { and, count, eq, inArray } from 'drizzle-orm';
import { appointment, appointmentType, planBooking } from './schema';
import type { DbOrTransaction } from './versioned';

/**
 * Book plan sessions (SCH-11; docs/runbooks/calendar.md). A series is a `plan_booking` row; its
 * appointments carry its id, and the database queues one WhatsApp plan sessions list for it.
 */

export const PLAN_SESSIONS_LIST_JOB = 'whatsapp.plan_sessions_list';

/**
 * An episode's session appointments (types in `packages.session_appointment_types`): booked and
 * not yet done (booked, confirmed, checked in, in progress), and completed. Cancelled,
 * rescheduled and no show ones are neither.
 */
export async function episodeSessionCounts(
  db: DbOrTransaction,
  episodeId: string,
  sessionTypeKeys: readonly string[],
): Promise<{ booked: number; done: number }> {
  if (sessionTypeKeys.length === 0) return { booked: 0, done: 0 };
  const rows = await db
    .select({ status: appointment.status, count: count() })
    .from(appointment)
    .innerJoin(appointmentType, eq(appointmentType.id, appointment.appointmentTypeId))
    .where(
      and(eq(appointment.episodeId, episodeId), inArray(appointmentType.key, [...sessionTypeKeys])),
    )
    .groupBy(appointment.status);
  const of = (statuses: string[]) =>
    rows.filter((row) => statuses.includes(row.status)).reduce((sum, row) => sum + row.count, 0);
  return {
    booked: of(['booked', 'confirmed', 'checked_in', 'in_progress']),
    done: of(['completed']),
  };
}

/** The id of the appointment type with a key, active or not. */
export async function appointmentTypeIdByKey(
  db: DbOrTransaction,
  key: string,
): Promise<string | undefined> {
  const [row] = await db
    .select({ id: appointmentType.id })
    .from(appointmentType)
    .where(eq(appointmentType.key, key));
  return row?.id;
}

export interface PlanBookingRecord {
  episodeId: string;
  centreId: string;
  physioId: string;
  appointmentTypeId: string;
  fromDate: string;
  weekdays: number[];
  time: string;
  bookedBy: string;
}

/** Records a series (inside the booking's transaction); its id. */
export async function recordPlanBooking(
  tx: DbOrTransaction,
  record: PlanBookingRecord,
): Promise<string> {
  const [row] = await tx.insert(planBooking).values(record).returning({ id: planBooking.id });
  if (!row) throw new Error('The plan series was not recorded.');
  return row.id;
}
