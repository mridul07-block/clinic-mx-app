import { sql } from 'drizzle-orm';
import type { Db } from '../client';
import { centre, staffUser, staffUserCentre } from '../schema';
import { seedCentres, seedStaff, seedStaffCentres } from './data';

export const seedTargets = ['local', 'staging'] as const;
export type SeedTarget = (typeof seedTargets)[number];

/** Production must never receive test staff, so the target has to be named explicitly. */
export function parseSeedTarget(value: string | undefined): SeedTarget {
  const target = seedTargets.find((t) => t === value);
  if (!target) {
    throw new Error(
      `CLINIC_MX_SEED_TARGET must be one of ${seedTargets.join(', ')}; got "${value ?? ''}".`,
    );
  }
  return target;
}

/** Inserts or updates the seed rows in one transaction. Safe to run repeatedly. */
export async function seed(db: Db) {
  await db.transaction(async (tx) => {
    await tx
      .insert(centre)
      .values(seedCentres)
      .onConflictDoUpdate({
        target: centre.id,
        set: {
          name: sql`excluded.name`,
          address: sql`excluded.address`,
          colour: sql`excluded.colour`,
          updatedAt: sql`now()`,
        },
      });
    await tx
      .insert(staffUser)
      .values(seedStaff)
      .onConflictDoUpdate({
        target: staffUser.id,
        set: {
          name: sql`excluded.name`,
          email: sql`excluded.email`,
          role: sql`excluded.role`,
          treatsPatients: sql`excluded.treats_patients`,
          consultant: sql`excluded.consultant`,
          updatedAt: sql`now()`,
        },
      });
    await tx.insert(staffUserCentre).values(seedStaffCentres).onConflictDoNothing();
  });

  const [counts] = await db.execute<{ centres: number; staff: number; assignments: number }>(sql`
    select
      (select count(*) from centre)::int as centres,
      (select count(*) from staff_user)::int as staff,
      (select count(*) from staff_user_centre)::int as assignments
  `);
  return counts;
}
