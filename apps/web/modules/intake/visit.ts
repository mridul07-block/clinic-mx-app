import 'server-only';
import { healthFormVisit, type PatientLinkAccess } from '@clinic-mx/db';
import { firstName, formatIstDateTime, healthFormOpen } from '@clinic-mx/schemas';
import { asPatient } from '../access/patient-db';

/**
 * What the health form's first screen shows (INT-03, user decision, 23 October 2026): the first
 * name and the visit, nothing else about the patient. Closed unless the visit is on (Checked in
 * or In consultation), so a cancelled, rescheduled, missed or finished visit, or a check in
 * undone, closes the link; checking in again opens it again.
 */
export type HealthFormWelcome =
  | { open: true; firstName: string; when: string; centreName: string; physioName: string }
  | { open: false };

/** The visit of an opened health form link, read as its patient under row level security. */
export async function loadHealthFormVisit(
  link: PatientLinkAccess,
  ip?: string,
): Promise<HealthFormWelcome> {
  const visit = await asPatient(link, (tx) => healthFormVisit(tx), ip);
  if (!visit || !healthFormOpen(visit.status)) return { open: false };
  return {
    open: true,
    firstName: firstName(visit.patientName),
    when: formatIstDateTime(visit.startsAt),
    centreName: visit.centreName,
    physioName: visit.physioName,
  };
}
