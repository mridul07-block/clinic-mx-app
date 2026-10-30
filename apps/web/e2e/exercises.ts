import { createDb, exercise, planOfCare, systemActor, withActor } from '@clinic-mx/db';
import { eq, inArray, isNull, and, sql } from 'drizzle-orm';
import { staffRow, testStaff } from './staff';

// The exercise library for end to end tests (SET-07): generated exercises ("E2E …"), retired
// afterwards (library exercises are never removed), and a plan's home programme pointing at one.

let database: ReturnType<typeof createDb> | undefined;
const db = () => {
  const url = process.env.DIRECT_DATABASE_URL;
  if (!url) throw new Error('DIRECT_DATABASE_URL is not set.');
  database ??= createDb(url, { max: 1, idleTimeoutSeconds: 1 });
  return database.db;
};

/** The first bytes of an MP4 (an `ftyp` box), padded to `size`: enough to pass the checks. */
export function fakeMp4(size: number): Buffer {
  const bytes = Buffer.alloc(size);
  bytes.set([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]);
  return bytes;
}

/** A library exercise without a video, added as the Super Admin would. */
export async function libraryExercise(name: string, defaultDose: string): Promise<string> {
  const admin = await staffRow(testStaff.superAdmin.email);
  return withActor(db(), systemActor('tests'), async (tx) => {
    const [row] = await tx
      .insert(exercise)
      .values({ name, defaultDose, createdBy: admin.id })
      .returning({ id: exercise.id });
    if (!row) throw new Error('The exercise was not added.');
    return row.id;
  });
}

/** The active library exercise of this name, as the Super Admin added it on screen. */
export async function exerciseNamed(name: string): Promise<string> {
  const [row] = await db()
    .select({ id: exercise.id })
    .from(exercise)
    .where(and(eq(exercise.name, name), isNull(exercise.retiredAt)));
  if (!row) throw new Error(`No library exercise ${name}`);
  return row.id;
}

/** Retires the test's exercises still active. */
export async function retireExercises(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await withActor(db(), systemActor('tests'), async (tx) => {
    await tx
      .update(exercise)
      .set({ retiredAt: sql`now()` })
      .where(and(inArray(exercise.id, ids), isNull(exercise.retiredAt)));
  });
}

/** Sets the consultation's plan's home programme to the one library exercise. */
export async function libraryHomeProgramme(
  consultationId: string,
  row: { exercise: string; dose: string; exerciseId: string },
): Promise<void> {
  await withActor(db(), systemActor('tests'), async (tx) => {
    await tx
      .update(planOfCare)
      .set({ homeProgramme: [{ ...row, note: '' }] })
      .where(eq(planOfCare.consultationId, consultationId));
  });
}
