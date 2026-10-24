import 'server-only';
import { withStaffAccess, type StaffMember } from '@clinic-mx/db';
import { appDb } from '../../lib/db';
import { clientIp, requireStaff } from '../auth/session';
import type { ServiceContext } from './service';

type Work<R> = Parameters<typeof withStaffAccess<R>>[2];

/**
 * Reads for a page, as the signed in staff member under row level security (IAM-05): the
 * database shows them only the rows their role, ticks and centres allow. Writes go through
 * `staffService`.
 */
export function asStaff<R>(actor: StaffMember, work: Work<R>): Promise<R> {
  return withStaffAccess(appDb(), { actor }, work);
}

/**
 * As `asStaff`, with the request's address for the audit trail: for reads that log a record view
 * (CLN-12).
 */
export async function asStaffViewing<R>(actor: StaffMember, work: Work<R>): Promise<R> {
  return withStaffAccess(appDb(), { actor, ip: await clientIp() }, work);
}

/** Who is acting and where from, for a server action that calls a staffService. */
export async function serviceContext(): Promise<ServiceContext> {
  return { db: appDb(), actor: await requireStaff(), ip: await clientIp() };
}
