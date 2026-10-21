import { sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { createDb } from '../client';
import { staffUser } from '../schema';
import { seedCentres, seedStaff, seedStaffCentres } from '../seed/data';
import { seed } from '../seed/seed';

// Runs against a migrated database (CI job "Local Supabase stack"); never against staging.
const url = process.env.DIRECT_DATABASE_URL;
if (!url) throw new Error('DIRECT_DATABASE_URL is not set.');
const { db, close } = createDb(url, { max: 1 });
afterAll(close);

/** The database constraint a failed query violated, read from the postgres.js error. */
async function violatedConstraint(query: Promise<unknown>): Promise<string | undefined> {
  try {
    await query;
  } catch (error) {
    const pgError = error instanceof Error && error.cause ? error.cause : error;
    return (pgError as { constraint_name?: string }).constraint_name;
  }
  return undefined;
}

const newStaff = (overrides: Partial<typeof staffUser.$inferInsert>) =>
  db.insert(staffUser).values({
    name: 'Test Rejected',
    email: `rejected.${crypto.randomUUID()}@clinicmx.test`,
    role: 'front_desk',
    ...overrides,
  });

describe('seed', () => {
  it('creates the 3 centres and test staff, and running it again changes nothing', async () => {
    const expected = {
      centres: seedCentres.length,
      staff: seedStaff.length,
      assignments: seedStaffCentres.length,
    };
    expect(await seed(db)).toEqual(expected);
    expect(await seed(db)).toEqual(expected);
    expect(expected.centres).toBe(3);
  });
});

describe('staff_user constraints', () => {
  it('rejects the Consultant tick without Treats patients (G5)', async () => {
    expect(await violatedConstraint(newStaff({ consultant: true }))).toBe(
      'staff_user_consultant_treats',
    );
  });

  it('rejects a physiotherapist who does not treat patients (G5)', async () => {
    expect(await violatedConstraint(newStaff({ role: 'physiotherapist' }))).toBe(
      'staff_user_physio_treats',
    );
  });

  it('rejects an email that differs only in case', async () => {
    expect(await violatedConstraint(newStaff({ email: 'DESK.HSR@clinicmx.test' }))).toBe(
      'staff_user_email_lower_key',
    );
  });
});

describe('row level security', () => {
  it.each(['anon', 'authenticated'])('lets the %s role read no identity rows', async (role) => {
    const rows = await db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('role', ${role}, true)`);
      return tx.execute<{ n: number }>(sql`
        select (select count(*) from centre)::int
             + (select count(*) from staff_user)::int
             + (select count(*) from staff_user_centre)::int as n
      `);
    });
    expect(rows[0]?.n).toBe(0);
  });
});
