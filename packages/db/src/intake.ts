import type { AppointmentStatus } from '@clinic-mx/schemas';
import { eq } from 'drizzle-orm';
import { appointment, centre, patient, patientLink, staffUser } from './schema';
import type { DbOrTransaction } from './versioned';

/** The visit a health form link is tied to, as its patient page shows it (INT-03). */
export interface HealthFormVisit {
  appointmentId: string;
  status: AppointmentStatus;
  startsAt: Date;
  patientName: string;
  centreName: string;
  physioName: string;
}

/**
 * The visit of the link the page runs under, read inside `withPatientAccess`: row level security
 * shows the patient only their own link and its appointment, so nothing here comes from the
 * browser. Undefined when the link has no appointment the patient can see.
 */
export async function healthFormVisit(db: DbOrTransaction): Promise<HealthFormVisit | undefined> {
  const [row] = await db
    .select({
      appointmentId: appointment.id,
      status: appointment.status,
      startsAt: appointment.startsAt,
      patientName: patient.name,
      centreName: centre.name,
      physioName: staffUser.name,
    })
    .from(patientLink)
    .innerJoin(appointment, eq(appointment.id, patientLink.appointmentId))
    .innerJoin(patient, eq(patient.id, appointment.patientId))
    .innerJoin(centre, eq(centre.id, appointment.centreId))
    .innerJoin(staffUser, eq(staffUser.id, appointment.physioId))
    .limit(1);
  return row;
}
