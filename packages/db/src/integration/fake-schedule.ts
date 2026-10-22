import { addDays, istDate, istInstant, type Block } from '@clinic-mx/schemas';
import { eq, sql } from 'drizzle-orm';
import { claimsForStaff } from '../access';
import { setAuditContext, staffActor } from '../audit';
import type { StaffMember } from '../identity';
import { insertPatient } from '../patients';
import { appointmentType, roster, staffUser, staffUserCentre } from '../schema';
import type { DbOrTransaction } from '../versioned';
import { fakePatientDetails } from './fake-patients';

/**
 * Generated people, hours and patients for the slot engine's database tests (SCH-04; rule 12:
 * never real data). A test physio works the same blocks every day from `rosterFrom`.
 */

/** A date far enough ahead that every slot on it is in the future. */
export const testDate = addDays(istDate(new Date()), 30);

/** A wall clock time on the test date, minutes after midnight IST. */
export const on = (minutes: number, date = testDate) => istInstant(date, minutes);

export async function typeId(db: DbOrTransaction, key: string): Promise<string> {
  const [row] = await db
    .select({ id: appointmentType.id })
    .from(appointmentType)
    .where(eq(appointmentType.key, key));
  if (!row) throw new Error(`no appointment type ${key}`);
  return row.id;
}

/** Adds a physio who treats patients at `centreIds`, with `blocks` every day there. */
export async function testPhysio(
  db: DbOrTransaction,
  options: {
    centreIds: string[];
    consultant?: boolean;
    blocks?: Block[];
    rosterFrom?: string;
    createdBy: string;
  },
): Promise<StaffMember> {
  const short = crypto.randomUUID().slice(0, 8);
  const [row] = await db
    .insert(staffUser)
    .values({
      email: `slot.physio.${short}@clinicmx.test`,
      name: `Test Slot Physio ${short}`,
      role: 'physiotherapist',
      treatsPatients: true,
      consultant: options.consultant ?? false,
    })
    .returning({ id: staffUser.id });
  if (!row) throw new Error('no physio');
  const blocks = options.blocks ?? [{ starts: 9 * 60, ends: 13 * 60 }];
  for (const centreId of options.centreIds) {
    await db.insert(staffUserCentre).values({ staffUserId: row.id, centreId });
    await db.insert(roster).values({
      staffUserId: row.id,
      centreId,
      effectiveFrom: options.rosterFrom ?? istDate(new Date()),
      weekly: Array.from({ length: 7 }, () => blocks),
      createdBy: options.createdBy,
    });
  }
  return {
    id: row.id,
    email: `slot.physio.${short}@clinicmx.test`,
    name: `Test Slot Physio ${short}`,
    role: 'physiotherapist',
    treatsPatients: true,
    consultant: options.consultant ?? false,
    centreIds: options.centreIds,
    support: false,
  };
}

export async function testPatient(db: DbOrTransaction): Promise<string> {
  return (await insertPatient(db, fakePatientDetails())).id;
}

/**
 * Inside a transaction begun as the database owner: from here on, act as `actor` under row level
 * security, the way `withStaffAccess` does. For tests that set up as the owner, then check what a
 * staff member sees, all rolled back.
 */
export async function becomeStaff(tx: DbOrTransaction, actor: StaffMember): Promise<void> {
  await setAuditContext(tx, { actor: staffActor(actor.id) });
  const claims = JSON.stringify({ role: 'authenticated', clinic: claimsForStaff(actor) });
  await tx.execute(sql`select set_config('request.jwt.claims', ${claims}, true)`);
  await tx.execute(sql`set local role authenticated`);
}
