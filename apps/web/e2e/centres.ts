import { centre, createDb, systemActor, withActor } from '@clinic-mx/db';
import { inArray } from 'drizzle-orm';

// Centres for end to end tests (SET-01). Tests that change centres hold the `e2e centres` lock,
// take a snapshot of the centres first and put them back afterwards. A centre a test added is
// left inactive: centres are never deleted.

let database: ReturnType<typeof createDb> | undefined;
const db = () => {
  const url = process.env.DIRECT_DATABASE_URL;
  if (!url) throw new Error('DIRECT_DATABASE_URL is not set.');
  database ??= createDb(url, { max: 1, idleTimeoutSeconds: 1 });
  return database.db;
};

export type CentreSnapshot = (typeof centre.$inferSelect)[];

/** Every centre as it is now. */
export function snapshotCentres(): Promise<CentreSnapshot> {
  return db().select().from(centre);
}

/**
 * Puts the snapshot's centres back as they were, and makes any centre added since inactive.
 * Inactive first, so no two active centres share a colour on the way.
 */
export async function restoreCentres(snapshot: CentreSnapshot): Promise<void> {
  await withActor(db(), systemActor('tests'), async (tx) => {
    const known = snapshot.map((row) => row.id);
    const added = (await tx.select({ id: centre.id }).from(centre))
      .map((row) => row.id)
      .filter((id) => !known.includes(id));
    if (added.length)
      await tx.update(centre).set({ active: false }).where(inArray(centre.id, added));
    await tx.update(centre).set({ active: false }).where(inArray(centre.id, known));
    for (const row of snapshot) {
      const { name, address, mapLink, reviewLink, phone, colour, active, treadmills } = row;
      await tx
        .update(centre)
        .set({ name, address, mapLink, reviewLink, phone, colour, active, treadmills })
        .where(inArray(centre.id, [row.id]));
    }
  });
}
