import 'server-only';
import {
  appointmentRecord,
  contentVersion,
  myPatientsToday,
  startVisit as startVisitRow,
  type MyPatientVisit,
  type StaffMember,
} from '@clinic-mx/db';
import { istDate, startVisitSchema } from '@clinic-mx/schemas';
import { assertMay } from '../access/guard';
import { staffService } from '../access/service';
import { asStaff } from '../access/staff-db';
import { SchedulingError, appointmentTarget } from '../scheduling/services';

/**
 * My patients today (CLN-01, Frontend Specification "Physiotherapist"): the signed in clinician's
 * own visits today, at every centre, in time order. Start marks a checked in visit In progress
 * ("With physio" on Today); only the appointment's own physio starts it, on its day (user
 * decision 24 October 2026). The consultation and session screens open from it with CLN-02 and
 * SES-03.
 */

export interface MyPatientsView {
  date: string;
  visits: MyPatientVisit[];
  version: string;
}

/** The person's visits today and their fingerprint, for the live check. */
export async function loadMyPatients(actor: StaffMember): Promise<MyPatientsView> {
  assertMay(actor, 'visits.start');
  const date = istDate(new Date());
  const visits = await asStaff(actor, (tx) => myPatientsToday(tx, { staffId: actor.id, date }));
  return { date, visits, version: contentVersion(visits) };
}

/** Starts the consultation or session of a checked in patient (CLN-01). */
export const startVisit = staffService({
  action: 'visits.start',
  input: startVisitSchema,
  target: (input, tx) => appointmentTarget(tx, input.appointmentId),
  run: async (tx, input, actor) => {
    const found = await appointmentRecord(tx, input.appointmentId);
    if (!found) throw new SchedulingError('That appointment was not found.');
    if (found.physioId !== actor.id) {
      throw new SchedulingError('Only the physio of this appointment can start it.');
    }
    if (found.status === 'in_progress') {
      throw new SchedulingError('This visit has started already.');
    }
    if (found.status !== 'checked_in') throw new SchedulingError('Check the patient in first.');
    const now = new Date();
    if (istDate(found.startsAt) !== istDate(now)) {
      throw new SchedulingError('A visit is started on its own day.');
    }
    if (!(await startVisitRow(tx, { appointmentId: found.id, by: actor.id, now }))) {
      throw new SchedulingError('Check the patient in first.');
    }
  },
});
