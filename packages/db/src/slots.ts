import {
  addDays,
  changeableStatuses,
  checkSlot,
  holdsSlot,
  isoWeekday,
  istDate,
  istInstant,
  slotRefusalMessages,
  slotStarts,
  startOfIstDay,
  type AppointmentChangeReason,
  type BookingChannel,
  type FreeSlot,
  type Interval,
  type Machine,
  type SlotCheck,
  type SlotQuery,
  type SlotRefusal,
  type Weekly,
} from '@clinic-mx/schemas';
import { and, asc, eq, gt, inArray, lte, sql } from 'drizzle-orm';
import { cutOut } from './rosters';
import {
  appointment,
  appointmentType,
  centre,
  physioAppointmentLength,
  roster,
  slotHold,
  staffUser,
} from './schema';
import type { DbOrTransaction } from './versioned';

/**
 * The slot engine (SCH-04, PRD J1.3, J1.5 and J1.8, TAD section 6): free starts per physio, holds
 * and booking, for the front desk now and the WhatsApp Flow later (WA-04). A physio's bookable
 * time is their roster at the centre with approved leave cut out; their appointments at every
 * centre and other holders' live holds are busy; a machine type also needs a free unit of the
 * centre's machine. The rules themselves are pure (`packages/schemas/src/slots.ts`).
 *
 * Reads run as the caller under row level security, except busy times: `internal.busy_times` and
 * `internal.machine_busy` give times only, so a front desk sees a physio's day at another centre
 * and their leave without reading those records. Holding and booking take advisory locks (the
 * physio, then the centre's machine, always in that order), release expired holds, recheck, then
 * write; the exclusion constraints refuse any overlap that still got through.
 */

/** A slot refused, with the reason staff and patients read. */
export class SlotRefusedError extends Error {
  override name = 'SlotRefusedError';
  constructor(readonly refusal: SlotRefusal) {
    super(slotRefusalMessages[refusal]);
  }
}

interface TypeRow {
  id: string;
  active: boolean;
  minutes: number;
  needsConsultant: boolean;
  machine: Machine | null;
}

export interface Busy extends Interval {
  physioId: string;
  kind: 'appointment' | 'hold' | 'leave';
}

/** Everything the rules need for one centre, type and span of days. */
interface Plan {
  type: TypeRow;
  /** People with hours at the centre who may take the type. */
  physios: PersonRow[];
  /** People with hours at the centre whom the type refuses (not consultants). */
  refused: Set<string>;
  versions: RosterRow[];
  busy: Map<string, Busy[]>;
  machineUnits: Interval[][] | undefined;
  lengths: Map<string, number>;
}

interface PlanRequest {
  centreId: string;
  appointmentTypeId: string;
  /** IST calendar dates, first and last. */
  from: string;
  to: string;
  physioId?: string;
  /** The asker's own hold does not count as busy. */
  holder?: string;
  /** Rescheduling this appointment (SCH-08): its own time does not count as busy. */
  freeing?: string;
}

async function typeRow(db: DbOrTransaction, id: string): Promise<TypeRow | undefined> {
  const [row] = await db
    .select({
      id: appointmentType.id,
      active: appointmentType.active,
      minutes: appointmentType.minutes,
      needsConsultant: appointmentType.needsConsultant,
      machine: appointmentType.machine,
    })
    .from(appointmentType)
    .where(eq(appointmentType.id, id));
  return row;
}

export interface PersonRow {
  id: string;
  name: string;
  consultant: boolean;
}

export interface RosterRow {
  staffUserId: string;
  effectiveFrom: string;
  weekly: Weekly;
}

/**
 * The people with hours at a centre between two IST dates (active, treating, not support), by
 * name, with their roster versions there and their busy times over the span.
 */
export async function loadPeople(
  db: DbOrTransaction,
  request: { centreId: string; from: string; to: string; physioId?: string; holder?: string },
): Promise<{ people: PersonRow[]; versions: RosterRow[]; busy: Map<string, Busy[]> }> {
  const from = startOfIstDay(request.from);
  const to = startOfIstDay(addDays(request.to, 1));
  const versions = await db
    .select({
      staffUserId: roster.staffUserId,
      effectiveFrom: roster.effectiveFrom,
      weekly: roster.weekly,
    })
    .from(roster)
    .where(
      and(
        eq(roster.centreId, request.centreId),
        lte(roster.effectiveFrom, request.to),
        request.physioId ? eq(roster.staffUserId, request.physioId) : undefined,
      ),
    )
    .orderBy(asc(roster.effectiveFrom));
  const rostered = [...new Set(versions.map((v) => v.staffUserId))];
  const people =
    rostered.length === 0
      ? []
      : await db
          .select({ id: staffUser.id, name: staffUser.name, consultant: staffUser.consultant })
          .from(staffUser)
          .where(
            and(
              inArray(staffUser.id, rostered),
              eq(staffUser.active, true),
              eq(staffUser.treatsPatients, true),
              eq(staffUser.velyxSupport, false),
            ),
          )
          .orderBy(asc(staffUser.name));
  const ids = people.map((p) => p.id);
  const busy = new Map<string, Busy[]>(ids.map((id) => [id, []]));
  if (ids.length > 0) {
    const rows = await db.execute<{
      physio_id: string;
      kind: Busy['kind'];
      starts_at: string;
      ends_at: string;
    }>(sql`select physio_id, kind, starts_at, ends_at
      from internal.busy_times(${`{${ids.join(',')}}`}::uuid[], ${from.toISOString()}::timestamptz,
        ${to.toISOString()}::timestamptz, ${request.holder ?? null}::text)`);
    for (const row of rows) {
      busy.get(row.physio_id)?.push({
        physioId: row.physio_id,
        kind: row.kind,
        startsAt: new Date(row.starts_at),
        endsAt: new Date(row.ends_at),
      });
    }
  }
  return {
    people,
    versions: versions.filter((v) => ids.includes(v.staffUserId)),
    busy,
  };
}

/** A person's working windows on a date at the centre, with approved leave cut out. */
export function windowsOn(
  versions: RosterRow[],
  busy: Busy[],
  physioId: string,
  date: string,
): Interval[] | undefined {
  const version = versions
    .filter((v) => v.staffUserId === physioId && v.effectiveFrom <= date)
    .at(-1);
  const blocks = version?.weekly[isoWeekday(date) - 1] ?? [];
  if (blocks.length === 0) return undefined;
  return cutOut(
    blocks.map((block) => ({
      startsAt: istInstant(date, block.starts),
      endsAt: istInstant(date, block.ends),
    })),
    busy.filter((b) => b.kind === 'leave'),
  );
}

async function loadPlan(db: DbOrTransaction, request: PlanRequest): Promise<Plan | undefined> {
  const type = await typeRow(db, request.appointmentTypeId);
  if (!type) return undefined;
  const from = startOfIstDay(request.from);
  const to = startOfIstDay(addDays(request.to, 1));
  const { people, versions, busy: everyone } = await loadPeople(db, request);
  const physios = people.filter((p) => !type.needsConsultant || p.consultant);
  const refused = new Set(people.filter((p) => !physios.includes(p)).map((p) => p.id));
  const ids = physios.map((p) => p.id);

  const busy = new Map<string, Busy[]>(ids.map((id) => [id, everyone.get(id) ?? []]));
  const lengths = new Map<string, number>();
  if (ids.length > 0) {
    const own = await db
      .select({
        staffUserId: physioAppointmentLength.staffUserId,
        minutes: physioAppointmentLength.minutes,
      })
      .from(physioAppointmentLength)
      .where(
        and(
          eq(physioAppointmentLength.appointmentTypeId, type.id),
          inArray(physioAppointmentLength.staffUserId, ids),
        ),
      );
    for (const id of ids) lengths.set(id, type.minutes);
    for (const row of own) lengths.set(row.staffUserId, row.minutes);
  }

  let machineUnits: Interval[][] | undefined;
  if (type.machine) {
    const [place] = await db
      .select({ treadmills: centre.treadmills })
      .from(centre)
      .where(eq(centre.id, request.centreId));
    machineUnits = Array.from({ length: place?.treadmills ?? 0 }, () => []);
    const rows = await db.execute<{ machine_unit: number; starts_at: string; ends_at: string }>(
      sql`select machine_unit, starts_at, ends_at from internal.machine_busy(
        ${request.centreId}::uuid, ${type.machine}::text, ${from.toISOString()}::timestamptz,
        ${to.toISOString()}::timestamptz, ${request.holder ?? null}::text)`,
    );
    for (const row of rows) {
      machineUnits[row.machine_unit - 1]?.push({
        startsAt: new Date(row.starts_at),
        endsAt: new Date(row.ends_at),
      });
    }
  }

  if (request.freeing) freeTime(await appointmentRecord(db, request.freeing), busy, machineUnits);

  return {
    type,
    physios,
    refused,
    versions: versions.filter((v) => ids.includes(v.staffUserId)),
    busy,
    machineUnits,
    lengths,
  };
}

/**
 * Takes an appointment being rescheduled out of the busy times (SCH-08), so it can move to a time
 * that overlaps its own (10:00 to 10:30 with the same physio). Busy times carry no ids, so the one
 * entry with its physio and times goes, and its treadmill unit's interval.
 */
function freeTime(
  freeing: AppointmentEntry | undefined,
  busy: Map<string, Busy[]>,
  machineUnits: Interval[][] | undefined,
): void {
  if (!freeing || !holdsSlot(freeing.status)) return;
  const same = (interval: Interval) =>
    interval.startsAt.getTime() === freeing.startsAt.getTime() &&
    interval.endsAt.getTime() === freeing.endsAt.getTime();
  const physio = busy.get(freeing.physioId);
  const index = physio?.findIndex((b) => b.kind === 'appointment' && same(b)) ?? -1;
  if (index >= 0) physio?.splice(index, 1);
  const unit = freeing.machineUnit ? machineUnits?.[freeing.machineUnit - 1] : undefined;
  const unitIndex = unit?.findIndex(same) ?? -1;
  if (unitIndex >= 0) unit?.splice(unitIndex, 1);
}

/** The rules' input for one physio on one date, or undefined when they have no hours then. */
function queryFor(
  plan: Plan,
  physioId: string,
  date: string,
  step: number,
  now: Date,
): SlotQuery | undefined {
  const busy = plan.busy.get(physioId) ?? [];
  const windows = windowsOn(plan.versions, busy, physioId, date);
  if (!windows) return undefined;
  return {
    windows,
    busy: busy.filter((b) => b.kind !== 'leave'),
    minutes: plan.lengths.get(physioId) ?? plan.type.minutes,
    step,
    now,
    machineUnits: plan.machineUnits,
  };
}

export interface PhysioSlots {
  physioId: string;
  physioName: string;
  slots: FreeSlot[];
}

export interface FreeSlotsRequest {
  centreId: string;
  appointmentTypeId: string;
  /** IST calendar date. */
  date: string;
  physioId?: string;
  holder?: string;
  /** Rescheduling this appointment (SCH-08): its own time counts as free. */
  freeing?: string;
  /** `scheduling.slot_minutes`. */
  step: number;
  now: Date;
}

/**
 * Free starts on a date, per physio who may take the type at the centre (by name); a physio with
 * no hours that day is left out. Refused when the type is inactive.
 */
export async function freeSlots(
  db: DbOrTransaction,
  request: FreeSlotsRequest,
): Promise<PhysioSlots[]> {
  const plan = await loadPlan(db, { ...request, from: request.date, to: request.date });
  if (!plan?.type.active) throw new SlotRefusedError('type_inactive');
  return plan.physios.flatMap((physio) => {
    const query = queryFor(plan, physio.id, request.date, request.step, request.now);
    if (!query) return [];
    return [{ physioId: physio.id, physioName: physio.name, slots: slotStarts(query) }];
  });
}

/** The dates from `from` on, `days` of them, with at least one free start (Flow screen 1). */
export async function datesWithFreeSlots(
  db: DbOrTransaction,
  request: Omit<FreeSlotsRequest, 'date' | 'physioId'> & { from: string; days: number },
): Promise<string[]> {
  const to = addDays(request.from, request.days - 1);
  const plan = await loadPlan(db, { ...request, to });
  if (!plan?.type.active) throw new SlotRefusedError('type_inactive');
  const dates: string[] = [];
  for (let offset = 0; offset < request.days; offset++) {
    const date = addDays(request.from, offset);
    const free = plan.physios.some((physio) => {
      const query = queryFor(plan, physio.id, date, request.step, request.now);
      return query !== undefined && slotStarts(query).length > 0;
    });
    if (free) dates.push(date);
  }
  return dates;
}

export interface SlotRequest {
  centreId: string;
  physioId: string;
  appointmentTypeId: string;
  startsAt: Date;
  /** Who is choosing: `staff:<id>` at the front desk, a Flow session on WhatsApp. */
  holder: string;
  /** Rescheduling this appointment (SCH-08): its own time counts as free. */
  freeing?: string;
  step: number;
  now: Date;
}

/**
 * Inside the caller's transaction: locks the physio (then the centre's machine), gives expired
 * holds their time back and rechecks the start. The free slot, or a SlotRefusedError.
 */
async function lockAndCheck(
  tx: DbOrTransaction,
  request: SlotRequest,
): Promise<{ slot: FreeSlot; machine: Machine | null }> {
  const type = await typeRow(tx, request.appointmentTypeId);
  if (!type?.active) throw new SlotRefusedError('type_inactive');
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`slot:physio:${request.physioId}`}, 0))`,
  );
  if (type.machine) {
    const key = `slot:machine:${request.centreId}:${type.machine}`;
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${key}, 0))`);
  }
  await tx.execute(sql`select internal.release_expired_slot_holds()`);
  const result = await slotFit(tx, request);
  if (!result.ok) throw new SlotRefusedError(result.refusal);
  return { slot: result.slot, machine: type.machine };
}

/**
 * Whether a start is free for one physio and type, by the engine's rules, without holding
 * anything: the slot, or the reason it is refused (the calendar's free slot drawer).
 */
export async function slotFit(
  db: DbOrTransaction,
  request: Omit<SlotRequest, 'holder'> & { holder?: string },
): Promise<SlotCheck> {
  const date = istDate(request.startsAt);
  const plan = await loadPlan(db, { ...request, from: date, to: date });
  if (!plan?.type.active) return { ok: false, refusal: 'type_inactive' };
  if (plan.refused.has(request.physioId)) return { ok: false, refusal: 'needs_consultant' };
  if (!plan.physios.some((p) => p.id === request.physioId)) {
    return { ok: false, refusal: 'not_offered' };
  }
  const query = queryFor(plan, request.physioId, date, request.step, request.now);
  if (!query) return { ok: false, refusal: 'outside_hours' };
  return checkSlot(query, request.startsAt);
}

/** An overlap the exclusion constraints caught (23P01) is a taken slot. */
async function refusingOverlaps<R>(work: Promise<R>): Promise<R> {
  try {
    return await work;
  } catch (error) {
    const code =
      (error as { cause?: { code?: string } }).cause?.code ?? (error as { code?: string }).code;
    if (code === '23P01') throw new SlotRefusedError('taken');
    throw error;
  }
}

/**
 * Holds a free start for `holdMinutes`, replacing the holder's earlier hold. Inside the caller's
 * transaction; the hold and when it lapses.
 */
export async function placeHold(
  tx: DbOrTransaction,
  request: SlotRequest & { holdMinutes: number },
): Promise<{ holdId: string; expiresAt: Date }> {
  await tx.delete(slotHold).where(eq(slotHold.holder, request.holder));
  const { slot, machine } = await lockAndCheck(tx, request);
  const expiresAt = new Date(request.now.getTime() + request.holdMinutes * 60 * 1000);
  const [row] = await refusingOverlaps(
    tx
      .insert(slotHold)
      .values({
        holder: request.holder,
        centreId: request.centreId,
        physioId: request.physioId,
        appointmentTypeId: request.appointmentTypeId,
        startsAt: slot.startsAt,
        endsAt: slot.endsAt,
        machine,
        machineUnit: slot.machineUnit,
        expiresAt,
      })
      .returning({ id: slotHold.id }),
  );
  if (!row) throw new Error('The hold was not recorded.');
  return { holdId: row.id, expiresAt };
}

/** The holder's hold, while it lasts (SCH-07: "Held for you until 10:35"). */
export async function currentHold(
  db: DbOrTransaction,
  holder: string,
  now: Date,
): Promise<
  | { physioId: string; appointmentTypeId: string; startsAt: Date; endsAt: Date; expiresAt: Date }
  | undefined
> {
  const [row] = await db
    .select({
      physioId: slotHold.physioId,
      appointmentTypeId: slotHold.appointmentTypeId,
      startsAt: slotHold.startsAt,
      endsAt: slotHold.endsAt,
      expiresAt: slotHold.expiresAt,
    })
    .from(slotHold)
    .where(and(eq(slotHold.holder, holder), gt(slotHold.expiresAt, now)));
  return row;
}

/** Gives back the holder's hold, if any. */
export async function releaseHold(tx: DbOrTransaction, holder: string): Promise<void> {
  await tx.delete(slotHold).where(eq(slotHold.holder, holder));
}

export interface BookingRequest extends SlotRequest {
  patientId: string;
  episodeId?: string;
  channel: BookingChannel;
  /** The staff member booking; none for a patient's own WhatsApp booking. */
  bookedBy?: string;
  /** The appointment this one replaces (SCH-08), already marked Rescheduled. */
  rescheduledFromId?: string;
}

/**
 * Books a free start: locks, rechecks (the holder's own hold is not busy), records the
 * appointment and gives back the hold. Inside the caller's transaction; its id and number, or a
 * SlotRefusedError.
 */
export async function bookAppointment(
  tx: DbOrTransaction,
  request: BookingRequest,
): Promise<{ id: string; number: string }> {
  const { slot, machine } = await lockAndCheck(tx, request);
  const [row] = await refusingOverlaps(
    tx
      .insert(appointment)
      .values({
        number: '',
        patientId: request.patientId,
        centreId: request.centreId,
        physioId: request.physioId,
        appointmentTypeId: request.appointmentTypeId,
        episodeId: request.episodeId,
        startsAt: slot.startsAt,
        endsAt: slot.endsAt,
        channel: request.channel,
        bookedBy: request.bookedBy,
        rescheduledFromId: request.rescheduledFromId,
        machine,
        machineUnit: slot.machineUnit,
      })
      .returning({ id: appointment.id, number: appointment.number }),
  );
  if (!row) throw new Error('The appointment was not recorded.');
  await releaseHold(tx, request.holder);
  return row;
}

export interface AppointmentEntry {
  id: string;
  number: string;
  patientId: string;
  centreId: string;
  physioId: string;
  appointmentTypeId: string;
  episodeId: string | null;
  startsAt: Date;
  endsAt: Date;
  status: (typeof appointment.$inferSelect)['status'];
  channel: BookingChannel;
  bookedBy: string | null;
  machineUnit: number | null;
  changeReason: AppointmentChangeReason | null;
  rescheduledFromId: string | null;
}

/** One appointment, or undefined when the reader cannot see it. */
export async function appointmentRecord(
  db: DbOrTransaction,
  appointmentId: string,
): Promise<AppointmentEntry | undefined> {
  const [row] = await db
    .select({
      id: appointment.id,
      number: appointment.number,
      patientId: appointment.patientId,
      centreId: appointment.centreId,
      physioId: appointment.physioId,
      appointmentTypeId: appointment.appointmentTypeId,
      episodeId: appointment.episodeId,
      startsAt: appointment.startsAt,
      endsAt: appointment.endsAt,
      status: appointment.status,
      channel: appointment.channel,
      bookedBy: appointment.bookedBy,
      machineUnit: appointment.machineUnit,
      changeReason: appointment.changeReason,
      rescheduledFromId: appointment.rescheduledFromId,
    })
    .from(appointment)
    .where(eq(appointment.id, appointmentId));
  return row;
}

/**
 * Cancels or reschedules a Booked or Confirmed appointment (SCH-08), recording who asked and who
 * did it. Inside the caller's transaction; the appointment, or undefined when it is not there or
 * no longer changeable. A reschedule then books the new one in the same transaction, so the old
 * time is never given up without it (PRD J1.7).
 */
export async function changeAppointment(
  tx: DbOrTransaction,
  change: {
    appointmentId: string;
    status: 'cancelled' | 'rescheduled';
    reason: AppointmentChangeReason;
    changedBy: string;
    now: Date;
  },
): Promise<{ id: string } | undefined> {
  const [row] = await tx
    .update(appointment)
    .set({
      status: change.status,
      changeReason: change.reason,
      changedAt: change.now,
      changedBy: change.changedBy,
      updatedAt: change.now,
    })
    .where(
      and(
        eq(appointment.id, change.appointmentId),
        inArray(appointment.status, [...changeableStatuses]),
      ),
    )
    .returning({ id: appointment.id });
  return row;
}

/**
 * Marks a Booked or Confirmed appointment a no show (INT-11), recording when and who; the
 * database counts it (SCH-09). The service checks `day.no_show_allowed_minutes` first.
 */
export async function markNoShow(
  tx: DbOrTransaction,
  mark: { appointmentId: string; by: string; now: Date },
): Promise<{ id: string } | undefined> {
  const [row] = await tx
    .update(appointment)
    .set({ status: 'no_show', noShowAt: mark.now, noShowBy: mark.by, updatedAt: mark.now })
    .where(
      and(
        eq(appointment.id, mark.appointmentId),
        inArray(appointment.status, [...changeableStatuses]),
      ),
    )
    .returning({ id: appointment.id });
  return row;
}

/**
 * Undoes a no show marked by mistake (INT-11, user decision 23 October 2026): back to Confirmed
 * if the patient had confirmed, otherwise Booked; the database takes the count back down.
 */
export async function undoNoShow(
  tx: DbOrTransaction,
  undo: { appointmentId: string; now: Date },
): Promise<{ id: string } | undefined> {
  const [row] = await tx
    .update(appointment)
    .set({
      status: sql`case when ${appointment.confirmedAt} is null then 'booked' else 'confirmed' end::appointment_status`,
      noShowAt: null,
      noShowBy: null,
      updatedAt: undo.now,
    })
    .where(and(eq(appointment.id, undo.appointmentId), eq(appointment.status, 'no_show')))
    .returning({ id: appointment.id });
  return row;
}
