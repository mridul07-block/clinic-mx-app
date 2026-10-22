import {
  addDays,
  isoWeekday,
  istDate,
  istInstant,
  slotStarts,
  startOfIstDay,
  type AppointmentChangeReason,
  type AppointmentStatus,
  type BookingChannel,
  type Interval,
} from '@clinic-mx/schemas';
import { and, asc, eq, gte, inArray, lt } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { appointment, appointmentType, patient, priceItem, staffUser } from './schema';
import { loadPeople, windowsOn } from './slots';
import type { DbOrTransaction } from './versioned';

/**
 * The calendar day view (SCH-05, Frontend Specification "Calendar"): a column per physio with
 * hours at the centre that day, their free grid cells, other holders' holds and their
 * appointments here. Run as the reader under row level security; busy times at other centres and
 * leave come through `internal.busy_times` (times only). The free cells are the slot engine's
 * starts with the grid as the length, so a cell is free exactly when a one cell booking would be.
 */

export interface CalendarAppointment {
  id: string;
  number: string;
  patientId: string;
  patientName: string;
  opNumber: string;
  appointmentTypeId: string;
  typeName: string;
  startsAt: Date;
  endsAt: Date;
  status: AppointmentStatus;
  channel: BookingChannel;
  bookedByName: string | null;
  machineUnit: number | null;
  episodeId: string | null;
  /** Cancelled or rescheduled (SCH-08): who asked, who did it and when. */
  changeReason: AppointmentChangeReason | null;
  changedByName: string | null;
  changedAt: Date | null;
  /** The appointment a reschedule booked in its place, or the one it replaced (SCH-08). */
  rescheduledTo: LinkedAppointment | null;
  rescheduledFrom: LinkedAppointment | null;
}

/** Another appointment to link to: where and which day it is on the calendar. */
export interface LinkedAppointment {
  id: string;
  number: string;
  centreId: string;
  /** IST calendar date. */
  date: string;
}

export interface CalendarColumn {
  physioId: string;
  physioName: string;
  consultant: boolean;
  /** The consultant's consultation fee (decision G4), when set. */
  fee: { label: string; amountPaise: number } | null;
  /** Working windows with approved leave cut out. */
  hours: Interval[];
  /** Free grid cells, by start. */
  freeCells: Date[];
  /** Other holders' live holds: being booked right now. */
  held: Interval[];
  appointments: CalendarAppointment[];
}

export interface CalendarDay {
  /** The span to draw: the earliest roster start to the latest end; null with nobody in. */
  span: Interval | null;
  columns: CalendarColumn[];
}

export interface CalendarRequest {
  centreId: string;
  /** IST calendar date. */
  date: string;
  /** Only this person's column (a physio sees their own schedule). */
  physioId?: string;
  holder?: string;
  /** `scheduling.slot_minutes`. */
  step: number;
  now: Date;
}

const bookedBy = alias(staffUser, 'booked_by_staff');
const changedBy = alias(staffUser, 'changed_by_staff');
const replacedBy = alias(appointment, 'replaced_by');
const replaced = alias(appointment, 'replaced');

const linked = (row: {
  id: string | null;
  number: string | null;
  centreId: string | null;
  startsAt: Date | null;
}): LinkedAppointment | null =>
  row.id && row.number && row.centreId && row.startsAt
    ? { id: row.id, number: row.number, centreId: row.centreId, date: istDate(row.startsAt) }
    : null;

/** The day at a centre, as the reader may see it. */
export async function calendarDay(
  db: DbOrTransaction,
  request: CalendarRequest,
): Promise<CalendarDay> {
  const { people, versions, busy } = await loadPeople(db, {
    ...request,
    from: request.date,
    to: request.date,
  });
  const ids = people.map((p) => p.id);
  const fees =
    ids.length === 0
      ? []
      : await db
          .select({ id: staffUser.id, label: priceItem.label, amountPaise: priceItem.amountPaise })
          .from(staffUser)
          .innerJoin(priceItem, eq(priceItem.id, staffUser.consultationPriceItemId))
          .where(inArray(staffUser.id, ids));
  const rows =
    ids.length === 0
      ? []
      : await db
          .select({
            id: appointment.id,
            number: appointment.number,
            physioId: appointment.physioId,
            patientId: appointment.patientId,
            patientName: patient.name,
            opNumber: patient.opNumber,
            appointmentTypeId: appointment.appointmentTypeId,
            typeName: appointmentType.name,
            startsAt: appointment.startsAt,
            endsAt: appointment.endsAt,
            status: appointment.status,
            channel: appointment.channel,
            bookedByName: bookedBy.name,
            machineUnit: appointment.machineUnit,
            episodeId: appointment.episodeId,
            changeReason: appointment.changeReason,
            changedByName: changedBy.name,
            changedAt: appointment.changedAt,
            toId: replacedBy.id,
            toNumber: replacedBy.number,
            toCentreId: replacedBy.centreId,
            toStartsAt: replacedBy.startsAt,
            fromId: replaced.id,
            fromNumber: replaced.number,
            fromCentreId: replaced.centreId,
            fromStartsAt: replaced.startsAt,
          })
          .from(appointment)
          .innerJoin(patient, eq(patient.id, appointment.patientId))
          .innerJoin(appointmentType, eq(appointmentType.id, appointment.appointmentTypeId))
          .leftJoin(bookedBy, eq(bookedBy.id, appointment.bookedBy))
          .leftJoin(changedBy, eq(changedBy.id, appointment.changedBy))
          .leftJoin(replacedBy, eq(replacedBy.rescheduledFromId, appointment.id))
          .leftJoin(replaced, eq(replaced.id, appointment.rescheduledFromId))
          .where(
            and(
              eq(appointment.centreId, request.centreId),
              inArray(appointment.physioId, ids),
              gte(appointment.startsAt, startOfIstDay(request.date)),
              lt(appointment.startsAt, startOfIstDay(addDays(request.date, 1))),
            ),
          )
          .orderBy(asc(appointment.startsAt));

  const columns: CalendarColumn[] = [];
  for (const person of people) {
    const own = busy.get(person.id) ?? [];
    const hours = windowsOn(versions, own, person.id, request.date);
    if (!hours) continue;
    const fee = fees.find((f) => f.id === person.id);
    columns.push({
      physioId: person.id,
      physioName: person.name,
      consultant: person.consultant,
      fee: fee ? { label: fee.label, amountPaise: fee.amountPaise } : null,
      hours,
      freeCells: slotStarts({
        windows: hours,
        busy: own.filter((b) => b.kind !== 'leave'),
        minutes: request.step,
        step: request.step,
        now: request.now,
      }).map((slot) => slot.startsAt),
      held: own
        .filter((b) => b.kind === 'hold')
        .map((b) => ({ startsAt: b.startsAt, endsAt: b.endsAt })),
      appointments: rows
        .filter((row) => row.physioId === person.id)
        .map(
          ({
            physioId: _physio,
            toId,
            toNumber,
            toCentreId,
            toStartsAt,
            fromId,
            fromNumber,
            fromCentreId,
            fromStartsAt,
            ...row
          }) => ({
            ...row,
            rescheduledTo: linked({
              id: toId,
              number: toNumber,
              centreId: toCentreId,
              startsAt: toStartsAt,
            }),
            rescheduledFrom: linked({
              id: fromId,
              number: fromNumber,
              centreId: fromCentreId,
              startsAt: fromStartsAt,
            }),
          }),
        ),
    });
  }

  // The rostered day, before leave: blocks of everyone with hours that day.
  const starts: number[] = [];
  const ends: number[] = [];
  for (const column of columns) {
    const version = versions
      .filter((v) => v.staffUserId === column.physioId && v.effectiveFrom <= request.date)
      .at(-1);
    for (const block of version?.weekly[isoWeekday(request.date) - 1] ?? []) {
      starts.push(block.starts);
      ends.push(block.ends);
    }
  }
  const span =
    starts.length === 0
      ? null
      : {
          startsAt: istInstant(request.date, Math.min(...starts)),
          endsAt: istInstant(request.date, Math.max(...ends)),
        };
  return { span, columns };
}

/** A short fingerprint of the day as the reader sees it; it changes whenever the view would. */
export function calendarVersion(day: CalendarDay): string {
  const text = JSON.stringify(day);
  let hash = 5381;
  for (let i = 0; i < text.length; i++) hash = ((hash << 5) + hash + text.charCodeAt(i)) | 0;
  return (hash >>> 0).toString(36);
}
