import 'server-only';
import {
  SlotRefusedError,
  appointmentRecord,
  bookAppointment,
  bookingCounterOf,
  changeAppointment,
  currentHold,
  episodeRecord,
  freeSlots,
  liftBookingBlock,
  markNoShow as markAppointmentNoShow,
  patientRecord,
  placeHold,
  releaseHold,
  undoNoShow as undoAppointmentNoShow,
  type DbOrTransaction,
  type PatientMatch,
  type PhysioSlots,
  type StaffMember,
} from '@clinic-mx/db';
import {
  bookNewPatientSchema,
  bookSlotSchema,
  canUndoNoShow,
  cancelAppointmentSchema,
  formatIstDateTime,
  freeSlotsQuerySchema,
  isChangeable,
  liftSelfBookingBlockSchema,
  markNoShowSchema,
  noShowAllowedFrom,
  releaseSlotSchema,
  rescheduleAppointmentSchema,
  selfBookingBlock,
  slotChoiceSchema,
  undoNoShowSchema,
  type BookSlotInput,
  type BookingChannel,
  type SelfBookingBlock,
} from '@clinic-mx/schemas';
import { assertCan, assertMay } from '../access/guard';
import { staffService, type ServiceContext, type ServiceTransaction } from '../access/service';
import { asStaff } from '../access/staff-db';
import { addPatient } from '../patients/services';
import { getSetting } from '../settings/settings';

/**
 * The slot engine for staff (SCH-04): free starts, a hold while choosing and the booking, for the
 * front desk's booking sheet (SCH-07) and the calendar (SCH-05). The engine itself is in
 * `packages/db/src/slots.ts`; a refused slot is a SlotRefusedError with the reason to show. Each
 * person holds at most one slot at a time. Settings are read before the transaction opens: with
 * one database connection per server instance, a settings load inside it would wait for ever
 * (SET-03).
 */

/** A refusal to show staff as it is. */
export class SchedulingError extends Error {
  override name = 'SchedulingError';
}

/** A staff member's holds are theirs alone; a WhatsApp Flow session has its own (WA-04). */
export const holderOf = (actor: StaffMember) => `staff:${actor.id}`;

/**
 * The appointment being rescheduled (SCH-08), when it may still move: Booked or Confirmed, at
 * the centre being booked, of the type being booked. Otherwise a refusal to show.
 */
async function movable(
  tx: DbOrTransaction,
  freeing: string,
  where: { centreId: string; appointmentTypeId?: string },
) {
  const old = await appointmentRecord(tx, freeing);
  if (
    !old ||
    !isChangeable(old.status) ||
    old.centreId !== where.centreId ||
    (where.appointmentTypeId !== undefined && old.appointmentTypeId !== where.appointmentTypeId)
  ) {
    throw new SchedulingError('Only a booked or confirmed appointment can be moved.');
  }
  return old;
}

/** Free starts on a date at a centre the person books for, per physio who may take the type. */
export async function findFreeSlots(actor: StaffMember, rawQuery: unknown): Promise<PhysioSlots[]> {
  assertMay(actor, 'bookings.manage');
  const query = freeSlotsQuerySchema.parse(rawQuery);
  assertCan(actor, 'bookings.manage', { centreId: query.centreId });
  const step = await getSetting('scheduling.slot_minutes');
  return asStaff(actor, async (tx) => {
    if (query.freeing) await movable(tx, query.freeing, query);
    return freeSlots(tx, { ...query, holder: holderOf(actor), step, now: new Date() });
  });
}

/** Holds a free start for `booking.slot_hold_minutes` while the person finishes the booking. */
export async function holdSlot(context: ServiceContext, rawInput: unknown) {
  const step = await getSetting('scheduling.slot_minutes');
  const holdMinutes = await getSetting('booking.slot_hold_minutes');
  return staffService({
    action: 'bookings.manage',
    input: slotChoiceSchema,
    target: (input) => Promise.resolve({ centreId: input.centreId }),
    run: async (tx, input, actor) => {
      if (input.freeing) await movable(tx, input.freeing, input);
      return placeHold(tx, {
        ...input,
        holder: holderOf(actor),
        holdMinutes,
        step,
        now: new Date(),
      });
    },
  })(context, rawInput);
}

/**
 * Books a free start for a patient as staff, inside the caller's transaction: the patient and any
 * episode checked, the slot rechecked, the person's hold given back. Shared by the desk's Book
 * (Front desk) and Walk in (INT-12).
 */
export async function bookFor(
  tx: ServiceTransaction,
  input: BookSlotInput,
  actor: StaffMember,
  { channel, step, now }: { channel: Exclude<BookingChannel, 'whatsapp'>; step: number; now: Date },
) {
  if (!(await patientRecord(tx, input.patientId))) {
    throw new SchedulingError('That patient was not found.');
  }
  if (input.episodeId) {
    const episode = await episodeRecord(tx, input.episodeId);
    if (episode?.patientId !== input.patientId || episode.status === 'discharged') {
      throw new SchedulingError('Book into an open episode of the same patient.');
    }
  }
  return bookAppointment(tx, {
    ...input,
    holder: holderOf(actor),
    channel,
    bookedBy: actor.id,
    step,
    now,
  });
}

/**
 * Books a free start for a patient at the front desk, rechecked inside the transaction; the
 * person's hold, if any, is given back. The appointment's id and number.
 */
export async function bookSlot(context: ServiceContext, rawInput: unknown) {
  const step = await getSetting('scheduling.slot_minutes');
  return staffService({
    action: 'bookings.manage',
    input: bookSlotSchema,
    target: (input) => Promise.resolve({ centreId: input.centreId }),
    run: (tx, input, actor) =>
      bookFor(tx, input, actor, { channel: 'front_desk', step, now: new Date() }),
  })(context, rawInput);
}

/** The person's own hold while it lasts, for the booking sheet (SCH-07). */
export function heldSlot(actor: StaffMember) {
  assertMay(actor, 'bookings.manage');
  return asStaff(actor, (tx) => currentHold(tx, holderOf(actor), new Date()));
}

/** Gives back the person's hold (Cancel on the booking sheet, SCH-07). */
export const releaseSlot = staffService({
  action: 'bookings.manage',
  input: releaseSlotSchema,
  target: (input) => Promise.resolve({ centreId: input.centreId }),
  run: (tx, _input, actor) => releaseHold(tx, holderOf(actor)),
});

export type BookNewPatientResult =
  | { status: 'booked'; id: string; number: string }
  /** The mobile is on file: nothing was added or booked; staff book one of these or confirm. */
  | { status: 'matches'; matches: PatientMatch[] };

/**
 * A caller or walk in who is new (SCH-07): adds them with a name and mobile at the booking's
 * centre (the centre issues the OP number), then books the held start for them with `book` (Book,
 * or Walk in's book and check in). Two audited writes; when the slot is refused after the patient
 * was added, the patient stays and the message says so.
 */
export async function addPatientThenBook(
  context: ServiceContext,
  details: { name: string; phone: string; confirmNewPerson: boolean; centreId: string },
  book: (patientId: string) => Promise<{ id: string; number: string }>,
): Promise<BookNewPatientResult> {
  const { name, phone, confirmNewPerson, centreId } = details;
  const added = await addPatient(context, {
    name,
    phone,
    registeredCentreId: centreId,
    confirmNewPerson,
  });
  if (added.status === 'matches') return added;
  try {
    const booked = await book(added.id);
    return { status: 'booked', ...booked };
  } catch (error) {
    if (error instanceof SlotRefusedError || error instanceof SchedulingError) {
      throw new SchedulingError(`Added ${name} (${added.opNumber}). ${error.message}`);
    }
    throw error;
  }
}

/** Adds a new caller, then books the held start for them (SCH-07). */
export async function addPatientAndBook(
  context: ServiceContext,
  rawInput: unknown,
): Promise<BookNewPatientResult> {
  const { name, phone, confirmNewPerson, ...slot } = bookNewPatientSchema.parse(rawInput);
  return addPatientThenBook(context, { name, phone, confirmNewPerson, ...slot }, (patientId) =>
    bookSlot(context, { ...slot, patientId }),
  );
}

/** Where an appointment is, for the permission check: its centre, or none when not seen. */
export async function appointmentTarget(tx: DbOrTransaction, appointmentId: string) {
  const found = await appointmentRecord(tx, appointmentId);
  if (!found) throw new SchedulingError('That appointment was not found.');
  return { centreId: found.centreId };
}

/**
 * Cancels a Booked or Confirmed appointment (SCH-08), recording who asked (the patient or the
 * clinic), who did it and when; its time is free again.
 */
export const cancelAppointment = staffService({
  action: 'bookings.manage',
  input: cancelAppointmentSchema,
  target: (input, tx) => appointmentTarget(tx, input.appointmentId),
  run: async (tx, input, actor) => {
    const changed = await changeAppointment(tx, {
      appointmentId: input.appointmentId,
      status: 'cancelled',
      reason: input.reason,
      changedBy: actor.id,
      now: new Date(),
    });
    if (!changed) {
      throw new SchedulingError('Only a booked or confirmed appointment can be cancelled.');
    }
  },
});

/**
 * Moves a Booked or Confirmed appointment to a new start, with any physio at the same centre
 * (SCH-08, user decisions 23 October 2026). One transaction marks the old one Rescheduled (who
 * asked, who did it, when) and books a new one of the same type for the same patient and
 * episode, at the front desk; if the new start is refused, nothing changes (PRD J1.7: the old
 * time is given up only for the new booking). The new appointment's id and number.
 */
/**
 * The package reschedule allowance's refusals (SCH-10), which the database raises when the old
 * appointment becomes Rescheduled, as the front desk reads them.
 */
const packageRefusals: [RegExp, string][] = [
  [
    /No reschedules left in this package/,
    'No reschedules left in this package. Only a move asked by the clinic is possible.',
  ],
  [
    /cannot be rescheduled at the patient's request/,
    'This package session cannot be moved at the patient’s request; only a move asked by the clinic is possible.',
  ],
];

function packageRefusal(error: unknown): SchedulingError | undefined {
  const cause = (error as { cause?: { message?: string } }).cause?.message ?? '';
  const refusal = packageRefusals.find(([pattern]) => pattern.test(cause));
  return refusal ? new SchedulingError(refusal[1]) : undefined;
}

export async function rescheduleAppointment(context: ServiceContext, rawInput: unknown) {
  const step = await getSetting('scheduling.slot_minutes');
  return staffService({
    action: 'bookings.manage',
    input: rescheduleAppointmentSchema,
    target: (input, tx) => appointmentTarget(tx, input.appointmentId),
    run: async (tx, input, actor) => {
      const old = await appointmentRecord(tx, input.appointmentId);
      const changed =
        old &&
        (await changeAppointment(tx, {
          appointmentId: old.id,
          status: 'rescheduled',
          reason: input.reason,
          changedBy: actor.id,
          now: new Date(),
        }).catch((error: unknown) => {
          throw packageRefusal(error) ?? error;
        }));
      if (!old || !changed) {
        throw new SchedulingError('Only a booked or confirmed appointment can be moved.');
      }
      return bookAppointment(tx, {
        centreId: old.centreId,
        physioId: input.physioId,
        appointmentTypeId: old.appointmentTypeId,
        startsAt: input.startsAt,
        holder: holderOf(actor),
        patientId: old.patientId,
        episodeId: old.episodeId ?? undefined,
        channel: 'front_desk',
        bookedBy: actor.id,
        rescheduledFromId: old.id,
        step,
        now: new Date(),
      });
    },
  })(context, rawInput);
}

export interface SelfBookingStatus extends SelfBookingBlock {
  limits: { reschedules: number; noShows: number };
  liftedAt: Date | null;
  liftedByName: string | null;
}

/**
 * Whether a patient may still book themselves (SCH-09, PRD J1.8), for those who book: the counts,
 * the limits and the last lift. The settings are read before the transaction (SET-03).
 */
export async function selfBookingStatus(
  actor: StaffMember,
  patientId: string,
): Promise<SelfBookingStatus> {
  assertMay(actor, 'bookings.manage');
  const limits = {
    reschedules: await getSetting('booking.self_booking_block_reschedules'),
    noShows: await getSetting('booking.self_booking_block_no_shows'),
  };
  const counter = await asStaff(actor, (tx) => bookingCounterOf(tx, patientId));
  return {
    ...selfBookingBlock(counter, limits),
    limits,
    liftedAt: counter.liftedAt,
    liftedByName: counter.liftedByName,
  };
}

/**
 * Lets a blocked patient book themselves again (SCH-09, user decision 23 October 2026: a Centre
 * Manager or the Super Admin), setting both counts to zero, audited.
 */
export const liftSelfBookingBlock = staffService({
  action: 'bookings.lift_self_booking_block',
  input: liftSelfBookingBlockSchema,
  run: async (tx, input, actor) => {
    if (!(await liftBookingBlock(tx, { ...input, liftedBy: actor.id, now: new Date() }))) {
      throw new SchedulingError('There is nothing to lift: no reschedules or no shows counted.');
    }
  },
});

/**
 * Marks a Booked or Confirmed appointment a no show (INT-11, PRD J2.9): the front desk, from
 * `day.no_show_allowed_minutes` after the start. The database counts it towards the self booking
 * block (SCH-09); the WhatsApp message and call task come with ALT-04.
 */
export async function markNoShow(context: ServiceContext, rawInput: unknown) {
  const allowedMinutes = await getSetting('day.no_show_allowed_minutes');
  return staffService({
    action: 'check_in.manage',
    input: markNoShowSchema,
    target: (input, tx) => appointmentTarget(tx, input.appointmentId),
    run: async (tx, input, actor) => {
      const found = await appointmentRecord(tx, input.appointmentId);
      if (!found || !isChangeable(found.status)) {
        throw new SchedulingError(
          'Only a booked or confirmed appointment can be marked a no show.',
        );
      }
      const now = new Date();
      const from = noShowAllowedFrom(found.startsAt, allowedMinutes);
      if (now < from) {
        throw new SchedulingError(`A no show can be marked from ${formatIstDateTime(from)}.`);
      }
      if (!(await markAppointmentNoShow(tx, { appointmentId: found.id, by: actor.id, now }))) {
        throw new SchedulingError(
          'Only a booked or confirmed appointment can be marked a no show.',
        );
      }
    },
  })(context, rawInput);
}

/**
 * Undoes a no show marked by mistake (INT-11, user decision 23 October 2026): on the
 * appointment's own day, back to Booked or Confirmed, and the count goes back down.
 */
export const undoNoShow = staffService({
  action: 'check_in.manage',
  input: undoNoShowSchema,
  target: (input, tx) => appointmentTarget(tx, input.appointmentId),
  run: async (tx, input) => {
    const found = await appointmentRecord(tx, input.appointmentId);
    if (!found || found.status !== 'no_show') {
      throw new SchedulingError('This appointment is not a no show.');
    }
    const now = new Date();
    if (!canUndoNoShow(found.startsAt, now)) {
      throw new SchedulingError('A no show can only be undone on its own day.');
    }
    if (!(await undoAppointmentNoShow(tx, { appointmentId: found.id, now }))) {
      throw new SchedulingError('This appointment is not a no show.');
    }
  },
});
