import 'server-only';
import { withPatientAccess, type PatientLinkAccess } from '@clinic-mx/db';
import { appDb } from '../../lib/db';

type Work<R> = Parameters<typeof withPatientAccess<R>>[2];

/**
 * Reads for a patient page, as the patient behind an opened link, under row level security
 * (IAM-09, rule 10): the database shows only the rows that link reaches.
 */
export function asPatient<R>(link: PatientLinkAccess, work: Work<R>, ip?: string): Promise<R> {
  return withPatientAccess(appDb(), { link, ip }, work);
}
