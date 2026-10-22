import { createDb, roster, staffLeave, systemActor, withActor } from '@clinic-mx/db';
import { inArray } from 'drizzle-orm';

// Rosters and leave for end to end tests (SET-04). Each test uses its own temporary people, so
// tests never share rows; afterwards their rosters and leave are removed (the audit keeps them).

let database: ReturnType<typeof createDb> | undefined;
const db = () => {
  const url = process.env.DIRECT_DATABASE_URL;
  if (!url) throw new Error('DIRECT_DATABASE_URL is not set.');
  database ??= createDb(url, { max: 1, idleTimeoutSeconds: 1 });
  return database.db;
};

/** Removes the rosters and leave of the given staff members. */
export async function removeRostersAndLeave(staffUserIds: string[]): Promise<void> {
  await withActor(db(), systemActor('tests'), async (tx) => {
    await tx.delete(staffLeave).where(inArray(staffLeave.staffUserId, staffUserIds));
    await tx.delete(roster).where(inArray(roster.staffUserId, staffUserIds));
  });
}
