import { z } from 'zod';
import { keyFromName } from './keys';

/**
 * Appointment types (SET-03, PRD M2): what can be booked and how long it takes. Decisions (user,
 * 22 October 2026): the Super Admin adds, renames, changes the length of, deactivates and
 * reactivates types (never deletes them); each physio may have their own length for any type, and
 * a blank length means the type's. Lengths are a whole number of calendar slots
 * (`scheduling.slot_minutes`, decision G2), checked in the service because the slot is a setting.
 */

/** The longest appointment a length may be: a guard against typing errors, not a clinic rule. */
export const MAX_APPOINTMENT_MINUTES = 8 * 60;

const minutesMessage = 'Enter the length in minutes, for example 45.';

/** A length in minutes as typed in a form field. */
export const appointmentMinutesSchema = z
  .string()
  .trim()
  .regex(/^\d+$/, { error: minutesMessage })
  .transform(Number)
  .pipe(
    z
      .number()
      .int()
      .min(1, { error: minutesMessage })
      .max(MAX_APPOINTMENT_MINUTES, { error: 'An appointment can be at most 8 hours.' }),
  );

/** Whether a length fits the calendar grid: a whole number of slots. */
export function fitsSlots(minutes: number, slotMinutes: number): boolean {
  return minutes > 0 && minutes % slotMinutes === 0;
}

/** The message when a length does not fit the grid. */
export const slotMessage = (slotMinutes: number) =>
  `Use steps of ${String(slotMinutes)} minutes, for example ${String(slotMinutes * 3)}.`;

/** Lengths as people read them: 45 minutes, 1 hour, 1 hour 30 minutes. */
export function formatMinutes(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  const hourText = hours === 0 ? '' : hours === 1 ? '1 hour' : `${String(hours)} hours`;
  const minuteText = rest === 0 ? '' : `${String(rest)} minutes`;
  return [hourText, minuteText].filter(Boolean).join(' ') || '0 minutes';
}

/** The stable key a type is known by in code, made from its name and never changed. */
export function appointmentTypeKey(name: string): string {
  return keyFromName(name);
}

export const appointmentTypeDetailsSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, { error: 'Enter the appointment type’s name.' })
    .max(60, { error: 'Keep the name under 60 characters.' })
    .regex(/[A-Za-z]/, { error: 'Use a name with letters in it.' }),
  minutes: appointmentMinutesSchema,
});

export type AppointmentTypeDetails = z.output<typeof appointmentTypeDetailsSchema>;

export const appointmentTypeUpdateSchema = appointmentTypeDetailsSchema.extend({
  appointmentTypeId: z.guid(),
});

export const appointmentTypeActiveSchema = z.object({
  appointmentTypeId: z.guid(),
  active: z.boolean(),
});

/** A physio's own lengths: for each type, minutes, or blank to use the type's length. */
export const physioLengthsSchema = z.object({
  staffUserId: z.guid(),
  lengths: z.array(
    z.object({
      appointmentTypeId: z.guid(),
      minutes: z.union([z.literal('').transform(() => null), appointmentMinutesSchema]),
    }),
  ),
});

export type PhysioLengths = z.output<typeof physioLengthsSchema>;
