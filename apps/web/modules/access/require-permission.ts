import 'server-only';
import type { StaffMember } from '@clinic-mx/db';
import { accessScope, type Action } from '@clinic-mx/schemas';
import { redirect } from 'next/navigation';
import { requireStaff } from '../auth/session';

/**
 * For pages that belong to one action (IAM-04): the signed in staff member, or the not allowed
 * page for anyone the permission map does not give the action. Record level checks (centre,
 * owner) happen in the service that reads the record.
 */
export async function requirePermission(action: Action): Promise<StaffMember> {
  const staff = await requireStaff();
  if (!accessScope(staff, action)) redirect('/app/not-allowed');
  return staff;
}
