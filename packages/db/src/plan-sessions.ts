import { desc, eq, sql } from 'drizzle-orm';
import { appointmentType, planBooking, planOfCare } from './schema';
import type { DbOrTransaction } from './versioned';

/**
 * Book plan sessions (SCH-11; docs/runbooks/calendar.md). A series is a `plan_booking` row; its
 * appointments carry its id, and the database queues one WhatsApp plan sessions list for it.
 */

export const PLAN_SESSIONS_LIST_JOB = 'whatsapp.plan_sessions_list';

/**
 * An episode's session appointments (types in `packages.session_appointment_types`): booked and
 * not yet done (booked, confirmed, checked in, in progress), and completed. Cancelled,
 * rescheduled and no show ones are neither. Counted by `internal.episode_session_counts`, so a
 * physio's count includes appointments with colleagues they cannot read (SCH-12); zero for a
 * reader the function does not serve.
 */
export async function episodeSessionCounts(
  db: DbOrTransaction,
  episodeId: string,
  sessionTypeKeys: readonly string[],
): Promise<{ booked: number; done: number }> {
  if (sessionTypeKeys.length === 0) return { booked: 0, done: 0 };
  const [row] = await db.execute<{ booked: number; done: number }>(
    sql`select booked, done from internal.episode_session_counts(${episodeId}::uuid, ${`{${sessionTypeKeys.join(',')}}`}::text[])`,
  );
  return { booked: row?.booked ?? 0, done: row?.done ?? 0 };
}

/** The newest plan of care's frequency for an episode, as those who read it see it (SCH-12). */
export async function planFrequencyOf(
  db: DbOrTransaction,
  episodeId: string,
): Promise<{ sessionsPerWeek: number | null; weeks: number | null } | undefined> {
  const [row] = await db
    .select({ sessionsPerWeek: planOfCare.sessionsPerWeek, weeks: planOfCare.weeks })
    .from(planOfCare)
    .where(eq(planOfCare.episodeId, episodeId))
    .orderBy(desc(planOfCare.version))
    .limit(1);
  return row;
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
