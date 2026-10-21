import { seesAllCentres, type StaffClaims } from '@clinic-mx/schemas';
import { sql } from 'drizzle-orm';
import { setAuditContext, staffActor } from './audit';
import type { Db } from './client';
import type { StaffMember } from './identity';

type Transaction = Parameters<Parameters<Db['transaction']>[0]>[0];

/** The `clinic` claim for a staff member, as internal.staff_claims builds it (IAM-03). */
export function claimsForStaff(staff: StaffMember): StaffClaims {
  return {
    staff_id: staff.id,
    role: staff.role,
    treats_patients: staff.treatsPatients,
    consultant: staff.consultant,
    all_centres: seesAllCentres(staff.role),
    centres: [...staff.centreIds].sort(),
  };
}

/**
 * Runs reads and writes as the signed in staff member, under row level security (IAM-05, rule 10):
 * one transaction as the `authenticated` role with their claims, the way their own token would
 * be, and with them as the audit actor. Everything is local to the transaction, so a pooled
 * connection never keeps the role. The claims equal the token's: the app refuses a request whose
 * token differs from the database (IAM-03).
 */
export async function withStaffAccess<R>(
  db: Db,
  { actor, ip }: { actor: StaffMember; ip?: string },
  work: (tx: Transaction) => Promise<R>,
): Promise<R> {
  return db.transaction(async (tx) => {
    await setAuditContext(tx, { actor: staffActor(actor.id), ip });
    const claims = JSON.stringify({ role: 'authenticated', clinic: claimsForStaff(actor) });
    await tx.execute(sql`select set_config('request.jwt.claims', ${claims}, true)`);
    await tx.execute(sql`set local role authenticated`);
    return work(tx);
  });
}
