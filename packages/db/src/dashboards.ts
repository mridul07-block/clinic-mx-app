import { addDays, startOfIstDay, utilisationMinutes, type AlertItem } from '@clinic-mx/schemas';
import { and, eq, gte, inArray, isNotNull, isNull, lt, notInArray, sql } from 'drizzle-orm';
import { appointment, staffUser } from './schema';
import { loadPeople, windowsOn } from './slots';
import type { DbOrTransaction } from './versioned';
import type { FigureScope } from './kpis';

/**
 * The Centre Manager's dashboards (DSH-03, docs/runbooks/manager-dashboards.md). Clinical and bill
 * figures come from the SECURITY DEFINER count functions (`internal.manager_alert_counts`,
 * `payment_pending_counts`, `team_daily`, `kpi_funnel`, `kpi_diagnosis_outcomes`): counts only, for
 * the Super Admin and Centre Managers, at the centres they see. Appointment figures (waiting,
 * bookings, busy hours, utilisation) are read under the reader's own row level security, which
 * already limits them to their centres. Run everything under `withStaffAccess`.
 */

const numberOf = (value: string | number | null): number => Number(value ?? 0);

export async function managerAlertCounts(
  db: DbOrTransaction,
): Promise<{ centreId: string; item: AlertItem; n: number }[]> {
  const rows = await db.execute<{ centre_id: string; item: AlertItem; n: string | number }>(
    sql`select centre_id, item, n from internal.manager_alert_counts()`,
  );
  return rows.map((row) => ({ centreId: row.centre_id, item: row.item, n: numberOf(row.n) }));
}

export async function paymentPendingCounts(
  db: DbOrTransaction,
): Promise<{ centreId: string; sinceToday: number; earlier: number }[]> {
  const rows = await db.execute<{
    centre_id: string;
    since_today: string | number;
    earlier: string | number;
  }>(sql`select centre_id, since_today, earlier from internal.payment_pending_counts()`);
  return rows.map((row) => ({
    centreId: row.centre_id,
    sinceToday: numberOf(row.since_today),
    earlier: numberOf(row.earlier),
  }));
}

export interface TeamDailyRow {
  centreId: string;
  physioId: string;
  day: string;
  metric: 'notes_signed_same_day' | 'visits_attended';
  numerator: number;
  denominator: number | null;
}

export async function teamDaily(
  db: DbOrTransaction,
  from: string,
  to: string,
): Promise<TeamDailyRow[]> {
  const rows = await db.execute<{
    centre_id: string;
    physio_id: string;
    day: string;
    metric: TeamDailyRow['metric'];
    numerator: string | number;
    denominator: string | number | null;
  }>(sql`select centre_id, physio_id, day::text as day, metric, numerator, denominator
    from internal.team_daily(${from}::date, ${to}::date)`);
  return rows.map((row) => ({
    centreId: row.centre_id,
    physioId: row.physio_id,
    day: row.day,
    metric: row.metric,
    numerator: numberOf(row.numerator),
    denominator: row.denominator === null ? null : numberOf(row.denominator),
  }));
}

export async function kpiFunnel(
  db: DbOrTransaction,
  from: string,
  to: string,
  scope: FigureScope = 'centres',
): Promise<{ centreId: string; stage: string; episodes: number }[]> {
  const fn = sql.raw(scope === 'own' ? 'internal.own_funnel' : 'internal.kpi_funnel');
  const rows = await db.execute<{ centre_id: string; stage: string; episodes: string | number }>(
    sql`select centre_id, stage, episodes from ${fn}(${from}::date, ${to}::date)`,
  );
  return rows.map((row) => ({
    centreId: row.centre_id,
    stage: row.stage,
    episodes: numberOf(row.episodes),
  }));
}

export interface DiagnosisOutcomeRow {
  centreId: string;
  conditionId: string;
  conditionName: string;
  diagnosed: number;
  discharged: number;
  paired: number;
  baselinePain: number | null;
  dischargePain: number | null;
}

export async function kpiDiagnosisOutcomes(
  db: DbOrTransaction,
  from: string,
  to: string,
  scope: FigureScope = 'centres',
): Promise<DiagnosisOutcomeRow[]> {
  const fn = sql.raw(
    scope === 'own' ? 'internal.own_diagnosis_outcomes' : 'internal.kpi_diagnosis_outcomes',
  );
  const rows = await db.execute<{
    centre_id: string;
    condition_id: string;
    condition_name: string;
    diagnosed: string | number;
    discharged: string | number;
    paired: string | number;
    baseline_pain: string | null;
    discharge_pain: string | null;
  }>(sql`select * from ${fn}(${from}::date, ${to}::date)`);
  return rows.map((row) => ({
    centreId: row.centre_id,
    conditionId: row.condition_id,
    conditionName: row.condition_name,
    diagnosed: numberOf(row.diagnosed),
    discharged: numberOf(row.discharged),
    paired: numberOf(row.paired),
    baselinePain: row.baseline_pain === null ? null : Number(row.baseline_pain),
    dischargePain: row.discharge_pain === null ? null : Number(row.discharge_pain),
  }));
}

const slotHolding = notInArray(appointment.status, ['cancelled', 'rescheduled']);
const came = inArray(appointment.status, ['checked_in', 'in_progress', 'completed']);

/** Today's visits that have arrived at the reader's centres: when booked, arrived and started. */
export function arrivalsToday(db: DbOrTransaction, today: string) {
  return db
    .select({
      centreId: appointment.centreId,
      startsAt: appointment.startsAt,
      arrivedAt: appointment.arrivedAt,
      startedAt: appointment.startedAt,
    })
    .from(appointment)
    .where(
      and(
        gte(appointment.startsAt, startOfIstDay(today)),
        lt(appointment.startsAt, startOfIstDay(addDays(today, 1))),
        isNotNull(appointment.arrivedAt),
        slotHolding,
      ),
    );
}

const istDay = sql<string>`((${appointment.startsAt} at time zone 'Asia/Kolkata')::date)::text`;

/** Appointments holding a slot per centre and IST day, from `from` to `to`. */
export async function appointmentsPerDay(
  db: DbOrTransaction,
  from: string,
  to: string,
): Promise<{ centreId: string; day: string; n: number }[]> {
  const rows = await db
    .select({
      centreId: appointment.centreId,
      day: istDay,
      n: sql<number>`count(*)::int`.mapWith(Number),
    })
    .from(appointment)
    .where(
      and(
        gte(appointment.startsAt, startOfIstDay(from)),
        lt(appointment.startsAt, startOfIstDay(addDays(to, 1))),
        slotHolding,
      ),
    )
    .groupBy(appointment.centreId, istDay);
  return rows;
}

/** New bookings (reschedules left out) per channel made since `from`, at the reader's centres. */
export async function bookingChannels(
  db: DbOrTransaction,
  from: string,
): Promise<{ channel: string; n: number }[]> {
  const rows = await db
    .select({ channel: appointment.channel, n: sql<number>`count(*)::int`.mapWith(Number) })
    .from(appointment)
    .where(
      and(gte(appointment.createdAt, startOfIstDay(from)), isNull(appointment.rescheduledFromId)),
    )
    .groupBy(appointment.channel);
  return rows;
}

const weekday =
  sql<number>`extract(isodow from ${appointment.startsAt} at time zone 'Asia/Kolkata')::int`.mapWith(
    Number,
  );
const hour =
  sql<number>`extract(hour from ${appointment.startsAt} at time zone 'Asia/Kolkata')::int`.mapWith(
    Number,
  );

/** Visits the patient came to, by IST weekday (1 Monday) and hour, since `from`. */
export async function busyHours(
  db: DbOrTransaction,
  from: string,
  to: string,
  centreId?: string,
): Promise<{ weekday: number; hour: number; n: number }[]> {
  const rows = await db
    .select({ weekday, hour, n: sql<number>`count(*)::int`.mapWith(Number) })
    .from(appointment)
    .where(
      and(
        gte(appointment.startsAt, startOfIstDay(from)),
        lt(appointment.startsAt, startOfIstDay(addDays(to, 1))),
        came,
        centreId ? eq(appointment.centreId, centreId) : undefined,
      ),
    )
    .groupBy(weekday, hour);
  return rows;
}

/**
 * A centre's utilisation on a day: the minutes its treating people are rostered there (approved
 * leave cut out) and the minutes booked inside them.
 */
export async function utilisationOn(
  db: DbOrTransaction,
  centreId: string,
  date: string,
): Promise<{ booked: number; rostered: number }> {
  const { people, versions, busy } = await loadPeople(db, { centreId, from: date, to: date });
  let booked = 0;
  let rostered = 0;
  for (const person of people) {
    const theirs = busy.get(person.id) ?? [];
    const windows = windowsOn(versions, theirs, person.id, date) ?? [];
    const minutes = utilisationMinutes(
      windows,
      theirs.filter((each) => each.kind === 'appointment'),
    );
    booked += minutes.booked;
    rostered += minutes.rostered;
  }
  return { booked, rostered };
}

/** The names of staff the reader may see, for the team figures. */
export async function staffNames(
  db: DbOrTransaction,
  ids: readonly string[],
): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const rows = await db
    .select({ id: staffUser.id, name: staffUser.name })
    .from(staffUser)
    .where(inArray(staffUser.id, [...ids]));
  return new Map(rows.map((row) => [row.id, row.name]));
}
