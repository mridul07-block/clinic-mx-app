import { endOfIstDay, type StaffDetails } from '@clinic-mx/schemas';
import { and, asc, desc, eq, notInArray, sql } from 'drizzle-orm';
import { centre, staffUser, staffUserCentre } from './schema';
import type { DbOrTransaction } from './versioned';

/**
 * Staff management (IAM-06). Run inside withStaffAccess as the Super Admin, so row level security
 * applies as well as the staff.manage permission. Nothing here deletes a staff member.
 */

export interface StaffListEntry {
  id: string;
  name: string;
  email: string;
  role: (typeof staffUser.$inferSelect)['role'];
  active: boolean;
  accessEndsAt: Date | null;
  authUserId: string | null;
  /** A Velyx support login (IAM-08). */
  velyxSupport: boolean;
  /** Names of their centres, in name order. */
  centres: string[];
}

/** Every staff member the caller sees: active first, then by name. */
export async function staffList(db: DbOrTransaction): Promise<StaffListEntry[]> {
  return db
    .select({
      id: staffUser.id,
      name: staffUser.name,
      email: staffUser.email,
      role: staffUser.role,
      active: staffUser.active,
      accessEndsAt: staffUser.accessEndsAt,
      authUserId: staffUser.authUserId,
      velyxSupport: staffUser.velyxSupport,
      // Table names written out: inside the join, a bare "id" would be the centre's.
      centres: sql<string[]>`array(
        select c.name from public.staff_user_centre a
        join public.centre c on c.id = a.centre_id
        where a.staff_user_id = "staff_user"."id"
        order by c.name)`,
    })
    .from(staffUser)
    .orderBy(desc(staffUser.active), asc(staffUser.name));
}

export interface StaffRecord {
  id: string;
  name: string;
  email: string;
  role: (typeof staffUser.$inferSelect)['role'];
  treatsPatients: boolean;
  consultant: boolean;
  active: boolean;
  accessEndsAt: Date | null;
  authUserId: string | null;
  velyxSupport: boolean;
  centreIds: string[];
}

/** One staff member with their assigned centres, if the caller sees them. */
export async function staffRecord(
  db: DbOrTransaction,
  staffUserId: string,
): Promise<StaffRecord | undefined> {
  const [row] = await db
    .select({
      id: staffUser.id,
      name: staffUser.name,
      email: staffUser.email,
      role: staffUser.role,
      treatsPatients: staffUser.treatsPatients,
      consultant: staffUser.consultant,
      active: staffUser.active,
      accessEndsAt: staffUser.accessEndsAt,
      authUserId: staffUser.authUserId,
      velyxSupport: staffUser.velyxSupport,
      centreIds: sql<string[]>`array(
        select a.centre_id::text from public.staff_user_centre a
        where a.staff_user_id = "staff_user"."id"
        order by a.centre_id)`,
    })
    .from(staffUser)
    .where(eq(staffUser.id, staffUserId))
    .limit(1);
  return row;
}

/** Whether a staff member already has this email (emails are unique whatever their case). */
export async function staffEmailTaken(db: DbOrTransaction, email: string): Promise<boolean> {
  const [row] = await db
    .select({ id: staffUser.id })
    .from(staffUser)
    .where(sql`lower(${staffUser.email}) = lower(${email})`)
    .limit(1);
  return Boolean(row);
}

const detailColumns = (details: StaffDetails) => ({
  name: details.name,
  role: details.role,
  treatsPatients: details.treatsPatients,
  consultant: details.consultant,
  accessEndsAt: details.accessEndsOn ? endOfIstDay(details.accessEndsOn) : null,
});

async function setCentres(db: DbOrTransaction, staffUserId: string, centreIds: string[]) {
  await db
    .delete(staffUserCentre)
    .where(
      centreIds.length
        ? and(
            eq(staffUserCentre.staffUserId, staffUserId),
            notInArray(staffUserCentre.centreId, centreIds),
          )
        : eq(staffUserCentre.staffUserId, staffUserId),
    );
  if (centreIds.length) {
    await db
      .insert(staffUserCentre)
      .values(centreIds.map((centreId) => ({ staffUserId, centreId })))
      .onConflictDoNothing();
  }
}

/** Adds a staff member and their centres, or a Velyx support login (IAM-08); returns their id. */
export async function insertStaffMember(
  db: DbOrTransaction,
  {
    email,
    details,
    velyxSupport = false,
  }: { email: string; details: StaffDetails; velyxSupport?: boolean },
): Promise<string> {
  const [row] = await db
    .insert(staffUser)
    .values({ email, ...detailColumns(details), velyxSupport })
    .returning({ id: staffUser.id });
  if (!row) throw new Error('The staff member was not added.');
  await setCentres(db, row.id, details.centreIds);
  return row.id;
}

/** Changes a staff member's details and replaces their centres. */
export async function updateStaffMember(
  db: DbOrTransaction,
  staffUserId: string,
  details: StaffDetails,
): Promise<boolean> {
  const updated = await db
    .update(staffUser)
    .set({ ...detailColumns(details), updatedAt: new Date() })
    .where(eq(staffUser.id, staffUserId))
    .returning({ id: staffUser.id });
  if (!updated.length) return false;
  await setCentres(db, staffUserId, details.centreIds);
  return true;
}

/** Deactivates or reactivates a staff member. Never deletes: their records stay theirs. */
export async function setStaffMemberActive(
  db: DbOrTransaction,
  staffUserId: string,
  active: boolean,
): Promise<boolean> {
  const updated = await db
    .update(staffUser)
    .set({ active, updatedAt: new Date() })
    .where(eq(staffUser.id, staffUserId))
    .returning({ id: staffUser.id });
  return updated.length > 0;
}

/** Links a staff member to their Supabase Auth login. */
export async function linkStaffLogin(
  db: DbOrTransaction,
  staffUserId: string,
  authUserId: string,
): Promise<void> {
  await db.update(staffUser).set({ authUserId }).where(eq(staffUser.id, staffUserId));
}

/**
 * The centres the caller sees, in name order, to choose from. New choices offer active centres
 * only (SET-01); an existing choice of an inactive one is still shown, marked, so it is kept.
 */
export function centreOptions(
  db: DbOrTransaction,
): Promise<{ id: string; name: string; active: boolean }[]> {
  return db
    .select({ id: centre.id, name: centre.name, active: centre.active })
    .from(centre)
    .orderBy(asc(centre.name));
}

/**
 * Ends every Supabase session of a staff member's login (IAM-07), so no device can refresh a
 * token for them. Only the Super Admin, under row level security; returns how many ended.
 */
export async function endStaffSessions(db: DbOrTransaction, staffUserId: string): Promise<number> {
  const rows = await db.execute<{ ended: number }>(
    sql`select internal.end_staff_sessions(${staffUserId}::uuid) as ended`,
  );
  return rows[0]?.ended ?? 0;
}
