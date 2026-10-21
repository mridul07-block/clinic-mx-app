import { and, asc, desc, eq, gt, inArray, lte, sql } from 'drizzle-orm';
import { isActor, type AuditContext } from './audit';
import { auditEvent, staffUser, supportGrant } from './schema';
import type { DbOrTransaction } from './versioned';

/**
 * Velyx support access (IAM-08). Grants are read and written inside withStaffAccess as the Super
 * Admin, under row level security; support requests are logged by the server for every request a
 * support login makes under a grant.
 */

export interface SupportGrantEntry {
  id: string;
  startsAt: Date;
  endsAt: Date;
  reason: string;
  grantedByName: string;
}

const grantColumns = {
  id: supportGrant.id,
  startsAt: supportGrant.startsAt,
  endsAt: supportGrant.endsAt,
  reason: supportGrant.reason,
  grantedByName: staffUser.name,
};

// Grants are timed by the database clock, which internal.staff_claims also reads.
const isActive = and(lte(supportGrant.startsAt, sql`now()`), gt(supportGrant.endsAt, sql`now()`));

/** The grant active now, if there is one (at most one is, see grantSupportAccess). */
export async function activeGrant(db: DbOrTransaction): Promise<SupportGrantEntry | undefined> {
  const [row] = await db
    .select(grantColumns)
    .from(supportGrant)
    .innerJoin(staffUser, eq(staffUser.id, supportGrant.grantedBy))
    .where(isActive)
    .orderBy(desc(supportGrant.endsAt))
    .limit(1);
  return row;
}

/** One page or action a support login asked for under a grant. */
export interface SupportRequestEntry {
  at: Date;
  staffName: string;
  path: string;
  kind: 'page' | 'action';
}

export interface SupportGrantWithActivity extends SupportGrantEntry {
  activity: SupportRequestEntry[];
}

/** The latest grants, newest first, each with what support did under it, newest first. */
export async function supportGrantHistory(
  db: DbOrTransaction,
  { grants = 10, requestsPerGrant = 200 } = {},
): Promise<SupportGrantWithActivity[]> {
  const rows = await db
    .select(grantColumns)
    .from(supportGrant)
    .innerJoin(staffUser, eq(staffUser.id, supportGrant.grantedBy))
    .orderBy(desc(supportGrant.startsAt))
    .limit(grants);
  if (!rows.length) return [];
  const events = await db
    .select({
      grantId: auditEvent.entityId,
      at: auditEvent.at,
      staffName: sql<string>`coalesce(${staffUser.name}, ${auditEvent.actor})`,
      path: sql<string>`${auditEvent.after} ->> 'path'`,
      kind: sql<'page' | 'action'>`${auditEvent.after} ->> 'kind'`,
    })
    .from(auditEvent)
    .leftJoin(staffUser, sql`${auditEvent.actor} = 'staff:' || ${staffUser.id}::text`)
    .where(
      and(
        eq(auditEvent.action, 'support_request'),
        eq(auditEvent.entity, 'support_grant'),
        inArray(
          auditEvent.entityId,
          rows.map((row) => row.id),
        ),
      ),
    )
    .orderBy(desc(auditEvent.at), desc(auditEvent.id));
  return rows.map((grant) => ({
    ...grant,
    activity: events
      .filter((event) => event.grantId === grant.id)
      .slice(0, requestsPerGrant)
      .map(({ at, staffName, path, kind }) => ({ at, staffName, path, kind })),
  }));
}

/** Records a grant from now for `hours`; returns it. */
export async function insertSupportGrant(
  db: DbOrTransaction,
  { grantedBy, hours, reason }: { grantedBy: string; hours: number; reason: string },
): Promise<{ id: string; endsAt: Date }> {
  const [row] = await db
    .insert(supportGrant)
    .values({ grantedBy, reason, endsAt: sql`now() + make_interval(hours => ${hours}::int)` })
    .returning({ id: supportGrant.id, endsAt: supportGrant.endsAt });
  if (!row) throw new Error('The grant was not recorded.');
  return row;
}

/** Ends a grant now, if it is still active; false when it had already ended. */
export async function endSupportGrant(db: DbOrTransaction, grantId: string): Promise<boolean> {
  const updated = await db
    .update(supportGrant)
    .set({ endsAt: sql`now()` })
    .where(and(eq(supportGrant.id, grantId), isActive))
    .returning({ id: supportGrant.id });
  return updated.length > 0;
}

/**
 * Ends every Supabase session of every Velyx support login, so none can refresh a token after
 * support access ends. Only the Super Admin, under row level security; returns how many ended.
 */
export async function endSupportSessions(db: DbOrTransaction): Promise<number> {
  const rows = await db.execute<{ ended: number }>(
    sql`select internal.end_support_sessions() as ended`,
  );
  return rows[0]?.ended ?? 0;
}

export interface SupportLoginEntry {
  id: string;
  name: string;
  email: string;
  active: boolean;
  authUserId: string | null;
}

/** The Velyx support logins, active first, then by name. */
export function supportLogins(db: DbOrTransaction): Promise<SupportLoginEntry[]> {
  return db
    .select({
      id: staffUser.id,
      name: staffUser.name,
      email: staffUser.email,
      active: staffUser.active,
      authUserId: staffUser.authUserId,
    })
    .from(staffUser)
    .where(eq(staffUser.velyxSupport, true))
    .orderBy(desc(staffUser.active), asc(staffUser.name));
}

/**
 * Records one request a Velyx support login made under a grant (IAM-08, TAD section 5: every
 * query under support access is logged): the page or action's path, never its query string.
 * Written by the server, outside the support login's read only transaction.
 */
export async function logSupportRequest(
  db: DbOrTransaction,
  {
    actor,
    ip,
    grantId,
    path,
    kind,
  }: AuditContext & { grantId: string; path: string; kind: 'page' | 'action' },
): Promise<void> {
  if (!isActor(actor)) throw new Error(`Not an audit actor: ${String(actor)}`);
  await db.insert(auditEvent).values({
    actor,
    action: 'support_request',
    entity: 'support_grant',
    entityId: grantId,
    after: { path, kind },
    ip,
  });
}
