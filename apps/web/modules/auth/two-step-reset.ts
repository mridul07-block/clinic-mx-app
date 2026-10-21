import 'server-only';
import {
  authUserIdForStaff,
  logAccessEvent,
  staffActor,
  type DbOrTransaction,
  type StaffMember,
} from '@clinic-mx/db';
import type { SupabaseAdmin } from '../../lib/supabase/admin';

export class NotAllowedError extends Error {
  override name = 'NotAllowedError';
}

/**
 * The Super Admin clears a staff member's authenticator apps when they lose or replace their
 * phone (IAM-02, decision 21 October 2026). Their next sign in asks them to set one up again
 * (required roles) or signs them in with the password (Front Desk). Audited as two_step_reset.
 * The staff screen (IAM-06) calls this; the permission map arrives with IAM-04.
 */
export async function resetTwoStep(
  { db, admin, ip }: { db: DbOrTransaction; admin: SupabaseAdmin; ip?: string },
  actor: StaffMember,
  staffUserId: string,
): Promise<{ removed: number }> {
  if (actor.role !== 'super_admin') {
    throw new NotAllowedError('Only the Super Admin can reset two step verification.');
  }
  const authUserId = await authUserIdForStaff(db, staffUserId);
  if (!authUserId) throw new NotAllowedError('That staff member has no login.');

  const { data, error } = await admin.auth.admin.mfa.listFactors({ userId: authUserId });
  if (error) throw error;
  for (const factor of data.factors) {
    const removed = await admin.auth.admin.mfa.deleteFactor({ userId: authUserId, id: factor.id });
    if (removed.error) throw removed.error;
  }
  await logAccessEvent(db, {
    actor: staffActor(actor.id),
    ip,
    action: 'two_step_reset',
    staffUserId,
  });
  return { removed: data.factors.length };
}
