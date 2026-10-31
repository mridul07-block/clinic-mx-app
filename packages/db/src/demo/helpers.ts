import { isoWeekday, istInstant } from '@clinic-mx/schemas';
import { sql } from 'drizzle-orm';
import type { StaffMember } from '../identity';
import { appointment } from '../schema';
import type { DbOrTransaction } from '../versioned';

type Tx = DbOrTransaction;

/** Acting as `staff` for the database's own checks (who signs, who discharges), still the owner. */
export async function actAs(tx: Tx, staff: StaffMember): Promise<void> {
  const claims = JSON.stringify({
    role: 'authenticated',
    clinic: { staff_id: staff.id, role: staff.role, all_centres: true, centres: [] },
  });
  await tx.execute(sql`select set_config('request.jwt.claims', ${claims}, true)`);
}

/** Back to the database owner with no staff claims. */
export async function actAsSystem(tx: Tx): Promise<void> {
  await tx.execute(sql`select set_config('request.jwt.claims', '', true)`);
}

/**
 * Times the history needs that the database sets to now (a signing, a milestone, a choice). They
 * are moved back once everything for a patient is written, with triggers off for just those
 * updates (`session_replication_role = replica`, as a restore runs): the records themselves went
 * through the database's rules when they were made.
 */
export class BackDates {
  private readonly steps: {
    table: string;
    column: string;
    value: string;
    set: [string, Date][];
  }[] = [];

  /** Sets `set`'s columns on the rows of `table` whose `column` is `value` (the id by default). */
  add(table: string, value: string, set: Record<string, Date>, column = 'id'): void {
    this.steps.push({ table, column, value, set: Object.entries(set) });
  }

  async apply(tx: Tx): Promise<void> {
    if (this.steps.length === 0) return;
    // A failure aborts the transaction, which puts the role back with everything else.
    await tx.execute(sql`set local session_replication_role = replica`);
    for (const step of this.steps) {
      const assignments = sql.join(
        step.set.map(
          ([name, at]) => sql`${sql.identifier(name)} = ${at.toISOString()}::timestamptz`,
        ),
        sql`, `,
      );
      await tx.execute(
        sql`update ${sql.identifier(step.table)} set ${assignments}
          where ${sql.identifier(step.column)} = ${step.value}::uuid`,
      );
    }
    await tx.execute(sql`set local session_replication_role = origin`);
  }
}

/** Minutes after `at`. */
export function after(at: Date, minutes: number): Date {
  return new Date(at.getTime() + minutes * 60_000);
}

/** The day itself, or the day before when it is a Sunday (the demo hours are Monday to Saturday). */
export function workingDay(day: string, step: 1 | -1 = -1): string {
  if (isoWeekday(day) !== 7) return day;
  const moved = new Date(`${day}T00:00:00Z`);
  moved.setUTCDate(moved.getUTCDate() + step);
  return moved.toISOString().slice(0, 10);
}

/** Starts the demo tries for a visit: inside the demo hours, morning first. */
export const DEMO_TIMES = [
  9 * 60 + 30,
  10 * 60 + 15,
  11 * 60,
  11 * 60 + 45,
  16 * 60 + 30,
  17 * 60 + 15,
  18 * 60,
  18 * 60 + 45,
  9 * 60,
  12 * 60 + 15,
  16 * 60,
  19 * 60 + 15,
];

/**
 * The first of `times` on `day` when `physioId` is free for `minutes` (no overbooking: the
 * database refuses overlapping visits), starting from `offset` so patients spread over the day.
 */
export async function freeStart(
  tx: Tx,
  physioId: string,
  day: string,
  minutes: number,
  offset = 0,
): Promise<Date | undefined> {
  for (let i = 0; i < DEMO_TIMES.length; i++) {
    const time = DEMO_TIMES[(i + offset) % DEMO_TIMES.length] ?? 9 * 60;
    const startsAt = istInstant(day, time);
    if (await isFree(tx, physioId, startsAt, after(startsAt, minutes))) return startsAt;
  }
  return undefined;
}

export async function isFree(tx: Tx, physioId: string, startsAt: Date, endsAt: Date) {
  const rows = await tx
    .select({ id: appointment.id })
    .from(appointment)
    .where(
      sql`${appointment.physioId} = ${physioId}
        and ${appointment.status} not in ('cancelled', 'rescheduled')
        and ${appointment.startsAt} < ${endsAt.toISOString()}::timestamptz
        and ${appointment.endsAt} > ${startsAt.toISOString()}::timestamptz`,
    )
    .limit(1);
  return rows.length === 0;
}

export interface VisitValues {
  patientId: string;
  centreId: string;
  physioId: string;
  appointmentTypeId: string;
  episodeId?: string;
  startsAt: Date;
  minutes: number;
  status:
    'booked' | 'confirmed' | 'checked_in' | 'in_progress' | 'completed' | 'no_show' | 'cancelled';
  channel: 'whatsapp' | 'front_desk' | 'walk_in';
  desk: StaffMember;
}

/** A visit written as it stands, with the times and people its status needs. */
export async function addVisit(tx: Tx, values: VisitValues): Promise<string> {
  const { startsAt, status, desk } = values;
  const came = ['checked_in', 'in_progress', 'completed'].includes(status);
  const started = ['in_progress', 'completed'].includes(status);
  const [row] = await tx
    .insert(appointment)
    .values({
      // The database numbers it.
      number: '',
      patientId: values.patientId,
      centreId: values.centreId,
      physioId: values.physioId,
      appointmentTypeId: values.appointmentTypeId,
      episodeId: values.episodeId,
      startsAt,
      endsAt: after(startsAt, values.minutes),
      channel: values.channel,
      bookedBy: values.channel === 'whatsapp' ? null : desk.id,
      status,
      arrivedAt: came ? after(startsAt, -5) : null,
      checkedInBy: came ? desk.id : null,
      startedAt: started ? startsAt : null,
      startedBy: started ? values.physioId : null,
      completedAt: status === 'completed' ? after(startsAt, values.minutes) : null,
      noShowAt: status === 'no_show' ? after(startsAt, 20) : null,
      noShowBy: status === 'no_show' ? desk.id : null,
      changeReason: status === 'cancelled' ? 'patient' : null,
      changedAt: status === 'cancelled' ? after(startsAt, -24 * 60) : null,
      changedBy: status === 'cancelled' ? desk.id : null,
    })
    .returning({ id: appointment.id });
  if (!row) throw new Error('The visit was not recorded.');
  return row.id;
}
