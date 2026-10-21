import { sql } from 'drizzle-orm';
import type { Db } from './client';
import { auditEvent } from './schema';
import type { DbOrTransaction } from './versioned';

/**
 * Who did something (FND-11): a staff member, a patient through a signed link, or a part of the
 * system. The audit trigger refuses any write to an audited table whose transaction names none.
 */
export type Actor = `staff:${string}` | `patient:${string}` | `system:${string}`;

const actorPattern = /^(staff|patient):[0-9a-f-]{36}$|^system:[a-z0-9._-]+$/;

export const staffActor = (staffUserId: string): Actor => `staff:${staffUserId}`;
export const patientActor = (patientId: string): Actor => `patient:${patientId}`;
export const systemActor = (component: string): Actor => `system:${component}`;

export function isActor(value: string): value is Actor {
  return actorPattern.test(value);
}

type Transaction = Parameters<Parameters<Db['transaction']>[0]>[0];

export interface AuditContext {
  actor: Actor;
  /** The request's client address, when there is one. */
  ip?: string;
}

/** Names the actor (and address) for every write in the current transaction. */
export async function setAuditContext(tx: DbOrTransaction, { actor, ip }: AuditContext) {
  if (!isActor(actor)) throw new Error(`Not an audit actor: ${String(actor)}`);
  await tx.execute(sql`select set_config('audit.actor', ${actor}, true)`);
  if (ip) await tx.execute(sql`select set_config('audit.ip', ${ip}, true)`);
}

/**
 * Runs writes in one transaction on behalf of `actor`: every change they make to an audited
 * table is recorded with it (rule 17: permission, validate, transaction, audit event).
 */
export async function withActor<R>(
  db: Db,
  context: AuditContext | Actor,
  work: (tx: Transaction) => Promise<R>,
): Promise<R> {
  const audit = typeof context === 'string' ? { actor: context } : context;
  return db.transaction(async (tx) => {
    await setAuditContext(tx, audit);
    return work(tx);
  });
}

/**
 * Records that `actor` opened a record (TAD section 5: every view of a clinical record is
 * logged). Call it from the server when a clinical record's details are returned.
 */
export async function logRecordView(
  db: DbOrTransaction,
  { actor, ip, entity, entityId }: AuditContext & { entity: string; entityId: string },
): Promise<void> {
  if (!isActor(actor)) throw new Error(`Not an audit actor: ${String(actor)}`);
  await db.insert(auditEvent).values({ actor, action: 'view', entity, entityId, ip });
}

export type AccessAction =
  | 'sign_in'
  | 'sign_out'
  | 'password_change'
  | 'two_step_on'
  | 'two_step_reset'
  | 'staff_invited'
  | 'invite_link_created';

/**
 * Records access to a staff account (IAM-01, IAM-02): signing in or out, a password change, two
 * step verification turned on, or reset by the Super Admin. `actor` did it to `staffUserId`.
 */
export async function logAccessEvent(
  db: DbOrTransaction,
  { actor, ip, action, staffUserId }: AuditContext & { action: AccessAction; staffUserId: string },
): Promise<void> {
  if (!isActor(actor)) throw new Error(`Not an audit actor: ${String(actor)}`);
  await db
    .insert(auditEvent)
    .values({ actor, action, entity: 'staff_user', entityId: staffUserId, ip });
}

/**
 * Records an access event about `staffUserId` from inside a transaction that names its actor,
 * including one under row level security (IAM-06): internal.record_access_event writes it with
 * that transaction's actor and address, so it cannot be recorded as anyone else.
 */
export async function recordAccessEvent(
  tx: DbOrTransaction,
  {
    action,
    staffUserId,
  }: { action: Exclude<AccessAction, 'sign_in' | 'sign_out'>; staffUserId: string },
): Promise<void> {
  await tx.execute(sql`select internal.record_access_event(${action}, ${staffUserId}::uuid)`);
}
