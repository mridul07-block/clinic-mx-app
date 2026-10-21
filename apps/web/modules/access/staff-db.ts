import 'server-only';
import { withStaffAccess, type StaffMember } from '@clinic-mx/db';
import { appDb } from '../../lib/db';

type Work<R> = Parameters<typeof withStaffAccess<R>>[2];

/**
 * Reads for a page, as the signed in staff member under row level security (IAM-05): the
 * database shows them only the rows their role, ticks and centres allow. Writes go through
 * `staffService`.
 */
export function asStaff<R>(actor: StaffMember, work: Work<R>): Promise<R> {
  return withStaffAccess(appDb(), { actor }, work);
}
