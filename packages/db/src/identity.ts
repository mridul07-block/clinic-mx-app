import { and, asc, eq, gt, isNull, not, or, sql } from 'drizzle-orm';
import { centre, staffUser, staffUserCentre } from './schema';
import type { DbOrTransaction } from './versioned';

/** What the server knows about a signed in staff member. */
export interface StaffMember {
  id: string;
  email: string;
  name: string;
  role: (typeof staffUser.$inferSelect)['role'];
  treatsPatients: boolean;
  consultant: boolean;
  /** Assigned centres; Super Admin and Finance see every centre whatever is listed here. */
  centreIds: string[];
  /** A Velyx support login (IAM-08): read only, and signed in only while access is granted. */
  support: boolean;
}

/**
 * Support access is granted now (IAM-08): some grant has started and not ended, by the database
 * clock that grants are timed with.
 */
const supportGranted = sql`exists (
  select 1 from public.support_grant g where g.starts_at <= now() and g.ends_at > now())`;

/**
 * The staff member a Supabase Auth user signs in as, if they may sign in now: linked, active,
 * before any access end date (PRD section 2) and, for a Velyx support login, while support access
 * is granted (IAM-08). Anyone else gets no session.
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
      centreIds: sql<string[]>`array(
        select a.centre_id::text from public.staff_user_centre a
        where a.staff_user_id = "staff_user"."id"
        order by a.centre_id)`,
      support: staffUser.velyxSupport,
    })
    .from(staffUser)
    .where(
      and(
        eq(staffUser.authUserId, authUserId),
        eq(staffUser.active, true),
        or(isNull(staffUser.accessEndsAt), gt(staffUser.accessEndsAt, now)),
        or(not(staffUser.velyxSupport), supportGranted),
      ),
    )
    .limit(1);
  return member;
}

/**
 * Whether a login is an active Velyx support login waiting for support access (IAM-08), so sign
 * in can say why it is refused once the password was right.
 */
export async function supportLoginWithoutGrant(
  db: DbOrTransaction,
  authUserId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: staffUser.id })
    .from(staffUser)
    .where(
      and(
        eq(staffUser.authUserId, authUserId),
        eq(staffUser.active, true),
        eq(staffUser.velyxSupport, true),
        not(supportGranted),
      ),
    )
    .limit(1);
  return Boolean(row);
}

/**
 * The claims a token for this login should carry now (IAM-03): what internal.staff_claims builds
 * for the access token hook, or null when the login is not an active staff member.
 */
export async function currentStaffClaims(
  db: DbOrTransaction,
  authUserId: string,
): Promise<unknown> {
  const rows = await db.execute<{ claims: unknown }>(
    sql`select internal.staff_claims(${authUserId}::uuid) as claims`,
  );
  return rows[0]?.claims ?? null;
}

/** Names of the centres a staff member is assigned to, in name order. */
export async function centreNamesForStaff(
  db: DbOrTransaction,
  staffUserId: string,
): Promise<string[]> {
  const rows = await db
    .select({ name: centre.name })
    .from(staffUserCentre)
    .innerJoin(centre, eq(centre.id, staffUserCentre.centreId))
    .where(eq(staffUserCentre.staffUserId, staffUserId))
    .orderBy(asc(centre.name));
  return rows.map((row) => row.name);
}
