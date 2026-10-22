import {
  createDb,
  discountPreset,
  packageType,
  packageTypeItem,
  priceItem,
  systemActor,
  withActor,
} from '@clinic-mx/db';
import { eq, inArray, like } from 'drizzle-orm';

// The price master for end to end tests (SET-02). Tests that change prices hold the `e2e prices`
// lock, take a snapshot of the price list first and put it back afterwards. Rows a test added are
// named "E2E …" and removed again (the audit trail keeps them), so the lists stay as the clinic's.

let database: ReturnType<typeof createDb> | undefined;
const db = () => {
  const url = process.env.DIRECT_DATABASE_URL;
  if (!url) throw new Error('DIRECT_DATABASE_URL is not set.');
  database ??= createDb(url, { max: 1, idleTimeoutSeconds: 1 });
  return database.db;
};

export type PriceSnapshot = (typeof priceItem.$inferSelect)[];

/** The price list as it is now. */
export function snapshotPrices(): Promise<PriceSnapshot> {
  return db().select().from(priceItem);
}

/** Removes the rows tests added and puts the snapshot's prices back as they were. */
export async function restorePrices(snapshot: PriceSnapshot): Promise<void> {
  await withActor(db(), systemActor('tests'), async (tx) => {
    const added = (
      await tx
        .select({ id: packageType.id })
        .from(packageType)
        .where(like(packageType.name, 'E2E %'))
    ).map((row) => row.id);
    if (added.length) {
      await tx.delete(packageTypeItem).where(inArray(packageTypeItem.packageTypeId, added));
      await tx.delete(packageType).where(inArray(packageType.id, added));
    }
    await tx.delete(discountPreset).where(like(discountPreset.name, 'E2E %'));
    await tx.delete(priceItem).where(like(priceItem.label, 'E2E %'));
    for (const { id, label, amountPaise, active } of snapshot) {
      await tx.update(priceItem).set({ label, amountPaise, active }).where(eq(priceItem.id, id));
    }
  });
}
