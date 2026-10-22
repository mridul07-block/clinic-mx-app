import 'server-only';
import {
  bookAppointment,
  episodeRecord,
  freeSlots,
  patientRecord,
  placeHold,
  type PhysioSlots,
  type StaffMember,
} from '@clinic-mx/db';
import { bookSlotSchema, freeSlotsQuerySchema, slotChoiceSchema } from '@clinic-mx/schemas';
import { assertCan, assertMay } from '../access/guard';
import { staffService, type ServiceContext } from '../access/service';
import { asStaff } from '../access/staff-db';
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

/** Free starts on a date at a centre the person books for, per physio who may take the type. */
export async function findFreeSlots(actor: StaffMember, rawQuery: unknown): Promise<PhysioSlots[]> {
  assertMay(actor, 'bookings.manage');
  const query = freeSlotsQuerySchema.parse(rawQuery);
  assertCan(actor, 'bookings.manage', { centreId: query.centreId });
  const step = await getSetting('scheduling.slot_minutes');
  return asStaff(actor, (tx) =>
    freeSlots(tx, { ...query, holder: holderOf(actor), step, now: new Date() }),
  );
}

/** Holds a free start for `booking.slot_hold_minutes` while the person finishes the booking. */
export async function holdSlot(context: ServiceContext, rawInput: unknown) {
  const step = await getSetting('scheduling.slot_minutes');
  const holdMinutes = await getSetting('booking.slot_hold_minutes');
  return staffService({
    action: 'bookings.manage',
    input: slotChoiceSchema,
    target: (input) => Promise.resolve({ centreId: input.centreId }),
    run: (tx, input, actor) =>
      placeHold(tx, { ...input, holder: holderOf(actor), holdMinutes, step, now: new Date() }),
  })(context, rawInput);
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
    run: async (tx, input, actor) => {
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
        channel: 'front_desk',
        bookedBy: actor.id,
        step,
        now: new Date(),
      });
    },
  })(context, rawInput);
}
