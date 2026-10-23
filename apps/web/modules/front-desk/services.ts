import 'server-only';
import {
  appointmentRecord,
  checkIn as checkInAppointment,
  undoCheckIn as undoAppointmentCheckIn,
} from '@clinic-mx/db';
import { canCheckIn, checkInSchema, isChangeable, undoCheckInSchema } from '@clinic-mx/schemas';
import { staffService } from '../access/service';
import { SchedulingError, appointmentTarget } from '../scheduling/services';

/**
 * Checks a Booked or Confirmed patient in from the Today board (INT-01, PRD J2.1): Checked in
 * with the arrival time, on the appointment's own day, by those who check in at its centre.
 * The Check in drawer (INT-02) adds the identity check, form status and QR around it.
 */
export const checkIn = staffService({
  action: 'check_in.manage',
  input: checkInSchema,
  target: (input, tx) => appointmentTarget(tx, input.appointmentId),
  run: async (tx, input) => {
    const found = await appointmentRecord(tx, input.appointmentId);
    if (!found || !isChangeable(found.status)) {
      throw new SchedulingError('Only a booked or confirmed appointment is checked in.');
    }
    const now = new Date();
    if (!canCheckIn(found.startsAt, now)) {
      throw new SchedulingError('Check a patient in on the appointment’s day.');
    }
    if (!(await checkInAppointment(tx, { appointmentId: found.id, now }))) {
      throw new SchedulingError('Only a booked or confirmed appointment is checked in.');
    }
  },
});

/**
 * Undoes a check in made by mistake (INT-01, user decision 23 October 2026): on the
 * appointment's own day, back to Booked or Confirmed without an arrival time.
 */
export const undoCheckIn = staffService({
  action: 'check_in.manage',
  input: undoCheckInSchema,
  target: (input, tx) => appointmentTarget(tx, input.appointmentId),
  run: async (tx, input) => {
    const found = await appointmentRecord(tx, input.appointmentId);
    if (!found || found.status !== 'checked_in') {
      throw new SchedulingError('This appointment is not checked in.');
    }
    const now = new Date();
    if (!canCheckIn(found.startsAt, now)) {
      throw new SchedulingError('A check in can only be undone on the appointment’s day.');
    }
    if (!(await undoAppointmentCheckIn(tx, { appointmentId: found.id, now }))) {
      throw new SchedulingError('This appointment is not checked in.');
    }
  },
});
