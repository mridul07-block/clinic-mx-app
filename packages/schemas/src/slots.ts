import { z } from 'zod';
import { istDate, startOfIstDay } from './ist';

/**
 * The slot engine's rules (SCH-04, PRD J1.3, J1.5 and J1.8, TAD section 6 Booking Flow), with no
 * I/O: which starts are free for a physio, and why a chosen start is refused. The database layer
 * (`packages/db/src/slots.ts`) loads the hours, appointments, holds and leave, runs these, and
 * rechecks inside the booking transaction; exclusion constraints are the last guard.
 * Decisions: a 15 minute grid with no buffer (G2, `scheduling.slot_minutes`); a Zero Gravity
 * Treadmill appointment takes the physio and one of the centre's treadmills (user, 22 October
 * 2026); a slot starts in the future.
 */

/** Appointment statuses (Frontend Specification); "Running late" is worked out from the time. */
export const appointmentStatuses = [
  'booked',
  'confirmed',
  'checked_in',
  'in_progress',
  'completed',
  'cancelled',
  'rescheduled',
  'no_show',
] as const;

export type AppointmentStatus = (typeof appointmentStatuses)[number];

export const appointmentStatusLabels = {
  booked: 'Booked',
  confirmed: 'Confirmed',
  checked_in: 'Checked in',
  in_progress: 'In progress',
  completed: 'Completed',
  cancelled: 'Cancelled',
  rescheduled: 'Rescheduled',
  no_show: 'No show',
} as const satisfies Record<AppointmentStatus, string>;

/** Statuses that give the time back; every other status keeps the physio and machine busy. */
export const freedStatuses = ['cancelled', 'rescheduled'] as const satisfies AppointmentStatus[];

export function holdsSlot(status: AppointmentStatus): boolean {
  return !(freedStatuses as readonly AppointmentStatus[]).includes(status);
}

/**
 * Reschedule and cancel (SCH-08): only a Booked or Confirmed appointment changes (user decision,
 * 23 October 2026: any time until check in); who asked is recorded, for the counters (SCH-09).
 */
export const changeableStatuses = ['booked', 'confirmed'] as const satisfies AppointmentStatus[];

export function isChangeable(status: AppointmentStatus): boolean {
  return (changeableStatuses as readonly AppointmentStatus[]).includes(status);
}

export const appointmentChangeReasons = ['patient', 'clinic'] as const;

export type AppointmentChangeReason = (typeof appointmentChangeReasons)[number];

export const appointmentChangeReasonLabels = {
  patient: 'By the patient',
  clinic: 'By the clinic',
} as const satisfies Record<AppointmentChangeReason, string>;

const changeReasonSchema = z.enum(appointmentChangeReasons, {
  error: 'Choose who asked for the change.',
});

/** Whether a patient may still book themselves, and why not (SCH-09, PRD J1.8). */
export interface SelfBookingBlock {
  blocked: boolean;
  reschedules: number;
  noShows: number;
  /** The limit reached first, reschedules before no shows; null when not blocked. */
  because: 'reschedules' | 'no_shows' | null;
}

/**
 * PRD J1.8: after `booking.self_booking_block_reschedules` reschedules asked by the patient, or
 * `booking.self_booking_block_no_shows` verified no shows, the patient books through the front
 * desk only. The WhatsApp Flow checks this before offering times; the front desk can always book.
 */
export function selfBookingBlock(
  counts: { reschedules: number; noShows: number },
  limits: { reschedules: number; noShows: number },
): SelfBookingBlock {
  const because =
    counts.reschedules >= limits.reschedules
      ? 'reschedules'
      : counts.noShows >= limits.noShows
        ? 'no_shows'
        : null;
  return { blocked: because !== null, ...counts, because };
}

/** Letting a blocked patient book themselves again (SCH-09): both counts back to zero. */
export const liftSelfBookingBlockSchema = z.object({ patientId: z.guid() });

/**
 * PRD J2.9 (INT-11): the front desk can mark a Booked or Confirmed appointment a no show from
 * `day.no_show_allowed_minutes` after its start.
 */
export function noShowAllowedFrom(startsAt: Date, allowedMinutes: number): Date {
  return new Date(startsAt.getTime() + allowedMinutes * 60_000);
}

/**
 * A no show marked by mistake is undone on the appointment's own day, in IST (user decision,
 * 23 October 2026); it goes back to Booked or Confirmed and the count goes back down.
 */
export function canUndoNoShow(startsAt: Date, now: Date): boolean {
  return istDate(startsAt) === istDate(now);
}

export const markNoShowSchema = z.object({ appointmentId: z.guid() });

export const undoNoShowSchema = z.object({ appointmentId: z.guid() });

/**
 * PRD section 7: patients book on the WhatsApp Flow; the front desk books callers (Front desk) and
 * walk ins, booked and checked in in one action (INT-12, user decision 23 October 2026).
 */
export const bookingChannels = ['whatsapp', 'front_desk', 'walk_in'] as const;

export type BookingChannel = (typeof bookingChannels)[number];

/** Machines a booking can need (G2); each centre has a count of each. */
export const machines = ['zero_gravity_treadmill'] as const;

export type Machine = (typeof machines)[number];

export const machineLabels = {
  zero_gravity_treadmill: 'Zero Gravity Treadmill',
} as const satisfies Record<Machine, string>;

/** A span of time, as UTC instants; it covers its start and stops just before its end. */
export interface Interval {
  startsAt: Date;
  endsAt: Date;
}

/** Whether two spans share time; touching ends do not (there is no buffer, G2). */
export function overlaps(a: Interval, b: Interval): boolean {
  return a.startsAt < b.endsAt && b.startsAt < a.endsAt;
}

export interface SlotQuery {
  /** When the physio can be booked at the centre: roster hours with approved leave cut out. */
  windows: Interval[];
  /** The physio's appointments (at every centre) and other holders' live holds. */
  busy: Interval[];
  /** The appointment's length with this physio. */
  minutes: number;
  /** The calendar grid, `scheduling.slot_minutes`. */
  step: number;
  now: Date;
  /** For a type that needs a machine: the busy spans of each of the centre's units. */
  machineUnits?: Interval[][];
}

export interface FreeSlot extends Interval {
  /** The machine unit (1 to the centre's count) the booking takes, or null. */
  machineUnit: number | null;
}

const MINUTE = 60 * 1000;

/** Whether an instant sits on the grid, counted from midnight IST. */
export function onGrid(instant: Date, step: number): boolean {
  const sinceMidnight = instant.getTime() - startOfIstDay(istDate(instant)).getTime();
  return sinceMidnight % (step * MINUTE) === 0;
}

/** The first grid instant at or after `instant`. */
function nextOnGrid(instant: Date, step: number): Date {
  const midnight = startOfIstDay(istDate(instant)).getTime();
  const stepMs = step * MINUTE;
  return new Date(midnight + Math.ceil((instant.getTime() - midnight) / stepMs) * stepMs);
}

function freeUnit(slot: Interval, units: Interval[][] | undefined): number | null | undefined {
  if (!units) return null;
  const index = units.findIndex((unit) => !unit.some((busy) => overlaps(slot, busy)));
  return index === -1 ? undefined : index + 1;
}

/**
 * Every free start for one physio, in time order: on the grid, after `now`, wholly inside a
 * window, clear of every busy span, and with a free machine unit when the type needs one.
 */
export function slotStarts(query: SlotQuery): FreeSlot[] {
  const { windows, busy, minutes, step, now, machineUnits } = query;
  const length = minutes * MINUTE;
  const free: FreeSlot[] = [];
  const ordered = [...windows].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  for (const window of ordered) {
    for (
      let start = nextOnGrid(window.startsAt, step);
      start.getTime() + length <= window.endsAt.getTime();
      start = new Date(start.getTime() + step * MINUTE)
    ) {
      if (start <= now) continue;
      const slot = { startsAt: start, endsAt: new Date(start.getTime() + length) };
      if (busy.some((span) => overlaps(slot, span))) continue;
      const machineUnit = freeUnit(slot, machineUnits);
      if (machineUnit === undefined) continue;
      free.push({ ...slot, machineUnit });
    }
  }
  return free;
}

export const slotRefusals = [
  'past',
  'off_grid',
  'outside_hours',
  'taken',
  'no_machine',
  'not_offered',
  'needs_consultant',
  'type_inactive',
] as const;

export type SlotRefusal = (typeof slotRefusals)[number];

/** What staff and patients read; "taken" is the design system's own wording. */
export const slotRefusalMessages = {
  past: 'That time has passed. Pick a later time.',
  off_grid: 'Pick a start time on the calendar grid.',
  outside_hours:
    'The physio is not working at this centre for all of that time. Pick another time.',
  taken: 'This slot was just booked. Pick another time.',
  no_machine: 'No Zero Gravity Treadmill is free then. Pick another time.',
  not_offered: 'That physio does not take appointments at this centre.',
  needs_consultant: 'This appointment is booked with a consultant. Pick a consultant physio.',
  type_inactive: 'That appointment type is no longer offered.',
} as const satisfies Record<SlotRefusal, string>;

export type SlotCheck = { ok: true; slot: FreeSlot } | { ok: false; refusal: SlotRefusal };

/** Whether one chosen start is free, by the same rules as `slotStarts`, and why not. */
export function checkSlot(query: SlotQuery, startsAt: Date): SlotCheck {
  if (startsAt <= query.now) return { ok: false, refusal: 'past' };
  if (!onGrid(startsAt, query.step)) return { ok: false, refusal: 'off_grid' };
  const slot = { startsAt, endsAt: new Date(startsAt.getTime() + query.minutes * MINUTE) };
  if (!query.windows.some((w) => w.startsAt <= slot.startsAt && slot.endsAt <= w.endsAt)) {
    return { ok: false, refusal: 'outside_hours' };
  }
  if (query.busy.some((span) => overlaps(slot, span))) return { ok: false, refusal: 'taken' };
  const machineUnit = freeUnit(slot, query.machineUnits);
  if (machineUnit === undefined) return { ok: false, refusal: 'no_machine' };
  return { ok: true, slot: { ...slot, machineUnit } };
}

/** Asking for a physio's free starts on a day (the calendar and the booking sheet). */
export const freeSlotsQuerySchema = z.object({
  centreId: z.guid(),
  date: z.iso.date(),
  appointmentTypeId: z.guid(),
  physioId: z.guid().optional(),
  /** Rescheduling this appointment (SCH-08): its own time counts as free. */
  freeing: z.guid().optional(),
});

export type FreeSlotsQuery = z.output<typeof freeSlotsQuerySchema>;

/** A chosen start for one physio, to hold or to book. */
export const slotChoiceSchema = z.object({
  centreId: z.guid(),
  physioId: z.guid(),
  appointmentTypeId: z.guid(),
  startsAt: z.coerce.date(),
  /** Rescheduling this appointment (SCH-08): its own time counts as free. */
  freeing: z.guid().optional(),
});

export type SlotChoice = z.output<typeof slotChoiceSchema>;

/** Booking a chosen start for a patient, optionally in an episode. */
export const bookSlotSchema = slotChoiceSchema.omit({ freeing: true }).extend({
  patientId: z.guid(),
  episodeId: z.guid().optional(),
});

export type BookSlotInput = z.output<typeof bookSlotSchema>;

/** Cancelling a Booked or Confirmed appointment, and who asked (SCH-08). */
export const cancelAppointmentSchema = z.object({
  appointmentId: z.guid(),
  reason: changeReasonSchema,
});

/**
 * Moving a Booked or Confirmed appointment to a new start, with any physio there (SCH-08): a new
 * appointment of the same type for the same patient; the old one becomes Rescheduled.
 */
export const rescheduleAppointmentSchema = z.object({
  appointmentId: z.guid(),
  physioId: z.guid(),
  startsAt: z.coerce.date(),
  reason: changeReasonSchema,
});
