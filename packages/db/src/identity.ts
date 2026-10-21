import { and, eq, gt, isNull, or } from 'drizzle-orm';
import { staffUser } from './schema';
import type { DbOrTransaction } from './versioned';

/** What the server knows about a signed in staff member. */
export interface StaffMember {
  id: string;
  email: string;
  name: string;
  role: (typeof staffUser.$inferSelect)['role'];
  treatsPatients: boolean;
  consultant: boolean;
}

/**
 * The staff member a Supabase Auth user signs in as, if they may sign in now: linked, active,
 * and before any access end date (PRD section 2). Anyone else gets no session.
 */
export async function staffForSignIn(
  db: DbOrTransaction,
  authUserId: string,
  now: Date = new Date(),
): Promise<StaffMember | undefined> {
  const [member] = await db
    .select({
      id: staffUser.id,
      email: staffUser.email,
      name: staffUser.name,
      role: staffUser.role,
      treatsPatients: staffUser.treatsPatients,
      consultant: staffUser.consultant,
    })
    .from(staffUser)
    .where(
      and(
        eq(staffUser.authUserId, authUserId),
        eq(staffUser.active, true),
        or(isNull(staffUser.accessEndsAt), gt(staffUser.accessEndsAt, now)),
      ),
    )
    .limit(1);
  return member;
}

/** The Supabase Auth user of a staff member, if their login exists. */
export async function authUserIdForStaff(
  db: DbOrTransaction,
  staffUserId: string,
): Promise<string | undefined> {
  const [row] = await db
    .select({ authUserId: staffUser.authUserId })
    .from(staffUser)
    .where(eq(staffUser.id, staffUserId))
    .limit(1);
  return row?.authUserId ?? undefined;
}
