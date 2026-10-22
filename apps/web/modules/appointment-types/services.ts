import 'server-only';
import {
  appointmentTypeKeyTaken,
  appointmentTypeList,
  appointmentTypeNameTaken,
  appointmentTypeRecord,
  insertAppointmentType,
  setAppointmentTypeActive,
  setPhysioLengths,
  staffRecord,
  updateAppointmentType,
} from '@clinic-mx/db';
import {
  appointmentTypeActiveSchema,
  appointmentTypeDetailsSchema,
  appointmentTypeKey,
  appointmentTypeUpdateSchema,
  fitsSlots,
  physioLengthsSchema,
  slotMessage,
} from '@clinic-mx/schemas';
import { staffService, type ServiceContext, type ServiceTransaction } from '../access/service';
import { getSetting } from '../settings/settings';

/**
 * Appointment types and their lengths (SET-03, PRD M2 and section 7). The Super Admin adds,
 * renames, changes the length of, deactivates and reactivates types (settings.manage) and sets a
 * physio's own lengths (staff.manage). Each is a staffService under row level security, audited.
 * Every length is a whole number of calendar slots (`scheduling.slot_minutes`, decision G2).
 *
 * The slot is read before the service's transaction opens, as `grantSupportAccess` does: the app
 * has one database connection per server instance, so a settings load inside the transaction
 * would wait for the connection the transaction holds, for ever.
 */

/** A refusal to show as it is; `field` names the form field it belongs to, if any. */
export class AppointmentTypeError extends Error {
  override name = 'AppointmentTypeError';
  constructor(
    message: string,
    readonly field?: string,
  ) {
    super(message);
  }
}

function checkSlots(minutes: number, slot: number, field: string) {
  if (!fitsSlots(minutes, slot)) throw new AppointmentTypeError(slotMessage(slot), field);
}

const slotMinutes = () => getSetting('scheduling.slot_minutes');

async function checkName(tx: ServiceTransaction, name: string, exceptId?: string) {
  if (await appointmentTypeNameTaken(tx, name, exceptId)) {
    throw new AppointmentTypeError('An appointment type with this name already exists.', 'name');
  }
}

/** Adds an appointment type, active from now, under a key made from its name. */
export async function addAppointmentType(context: ServiceContext, rawInput: unknown) {
  const slot = await slotMinutes();
  return staffService({
    action: 'settings.manage',
    input: appointmentTypeDetailsSchema,
    run: async (tx, details) => {
      checkSlots(details.minutes, slot, 'minutes');
      await checkName(tx, details.name);
      const key = appointmentTypeKey(details.name);
      if (await appointmentTypeKeyTaken(tx, key)) {
        throw new AppointmentTypeError(
          'Another appointment type has a name too close to this one. Choose a different name.',
          'name',
        );
      }
      return insertAppointmentType(tx, { ...details, key });
    },
  })(context, rawInput);
}

/** Changes a type's name or length; its key stays as it was. */
export async function editAppointmentType(context: ServiceContext, rawInput: unknown) {
  const slot = await slotMinutes();
  return staffService({
    action: 'settings.manage',
    input: appointmentTypeUpdateSchema,
    run: async (tx, { appointmentTypeId, ...details }) => {
      if (!(await appointmentTypeRecord(tx, appointmentTypeId))) {
        throw new AppointmentTypeError('That appointment type was not found.');
      }
      checkSlots(details.minutes, slot, 'minutes');
      await checkName(tx, details.name, appointmentTypeId);
      await updateAppointmentType(tx, appointmentTypeId, details);
    },
  })(context, rawInput);
}

/** Deactivates a type (no longer offered for new bookings; history stays) or reactivates it. */
export const setAppointmentTypeActiveService = staffService({
  action: 'settings.manage',
  input: appointmentTypeActiveSchema,
  run: async (tx, { appointmentTypeId, active }) => {
    if (!(await appointmentTypeRecord(tx, appointmentTypeId))) {
      throw new AppointmentTypeError('That appointment type was not found.');
    }
    if (!(await setAppointmentTypeActive(tx, appointmentTypeId, active))) {
      throw new AppointmentTypeError(
        active
          ? 'That appointment type is already active.'
          : 'That appointment type is already inactive.',
      );
    }
  },
});

/**
 * Sets a physio's own lengths: minutes for a type, or blank to use the type's length. Only for
 * staff who treat patients.
 */
export async function setPhysioLengthsService(context: ServiceContext, rawInput: unknown) {
  const slot = await slotMinutes();
  return staffService({
    action: 'staff.manage',
    input: physioLengthsSchema,
    run: async (tx, { staffUserId, lengths }) => {
      const member = await staffRecord(tx, staffUserId);
      if (!member) throw new AppointmentTypeError('That staff member was not found.');
      if (!member.treatsPatients) {
        throw new AppointmentTypeError('Only staff who treat patients have appointment lengths.');
      }
      const types = new Set((await appointmentTypeList(tx)).map((type) => type.id));
      for (const { appointmentTypeId, minutes } of lengths) {
        if (!types.has(appointmentTypeId)) {
          throw new AppointmentTypeError('One of the appointment types was not found.');
        }
        if (minutes !== null) checkSlots(minutes, slot, appointmentTypeId);
      }
      await setPhysioLengths(tx, staffUserId, lengths);
    },
  })(context, rawInput);
}
