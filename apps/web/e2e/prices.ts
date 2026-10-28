import {
  createDb,
  discountPreset,
  packageType,
  packageTypeItem,
  patientPlanChoice,
  priceItem,
  systemActor,
  withActor,
} from '@clinic-mx/db';
import { eq, inArray, like, sql } from 'drizzle-orm';

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
      // A patient's choice of a test package (BIL-02) goes with it, and its bill (BIL-05).
      const chosen = sql`(select id from plan_choice where package_type_id in ${added})`;
      const chosenBills = sql`(select id from bill where plan_choice_id in ${chosen})`;
      // The packages those bills bought (BIL-08), and their expiry reminders.
      const bought = sql`(select id::text from package where bill_id in ${chosenBills})`;
      await tx.execute(sql`delete from job where payload ->> 'packageId' in ${bought}`);
      // Session notes that used those packages (SES-03), after their addenda.
      await tx.execute(
        sql`delete from addendum where session_id in
          (select id from session where package_id::text in ${bought})`,
      );
      for (const table of ['reassessment', 'baseline_measure', 'measure']) {
        await tx.execute(
          sql`delete from ${sql.identifier(table)} where session_id in
            (select id from session where package_id::text in ${bought})`,
        );
      }
      await tx.execute(sql`delete from session where package_id::text in ${bought}`);
      await tx.execute(sql`delete from package where bill_id in ${chosenBills}`);
      await tx.execute(sql`delete from refund_credit where bill_id in ${chosenBills}`);
      await tx.execute(sql`delete from payment where bill_id in ${chosenBills}`);
      await tx.execute(sql`delete from bill_line where bill_id in ${chosenBills}`);
      await tx.execute(sql`delete from bill where plan_choice_id in ${chosen}`);
      await tx.delete(patientPlanChoice).where(inArray(patientPlanChoice.packageTypeId, added));
      await tx.delete(packageTypeItem).where(inArray(packageTypeItem.packageTypeId, added));
      await tx.delete(packageType).where(inArray(packageType.id, added));
    }
    // Bills a test discounted with an "E2E" preset (BIL-07) go with it.
    const discounted = (
      await tx.execute<{ id: string }>(
        sql`select distinct l.bill_id as id from bill_line l join discount_preset p
          on p.id = l.discount_preset_id where p.name like 'E2E %'`,
      )
    ).map((row) => row.id);
    if (discounted.length > 0) {
      await tx.execute(sql`delete from package where bill_id in ${discounted}`);
      await tx.execute(sql`delete from refund_credit where bill_id in ${discounted}`);
      await tx.execute(sql`delete from payment where bill_id in ${discounted}`);
      await tx.execute(sql`delete from bill_line where bill_id in ${discounted}`);
      await tx.execute(sql`delete from bill where id in ${discounted}`);
    }
    await tx.delete(discountPreset).where(like(discountPreset.name, 'E2E %'));
    await tx.delete(priceItem).where(like(priceItem.label, 'E2E %'));
    for (const { id, label, amountPaise, active } of snapshot) {
      await tx.update(priceItem).set({ label, amountPaise, active }).where(eq(priceItem.id, id));
    }
  });
}

/** An "E2E …" preset discount (BIL-07), removed by `restorePrices`; its id. */
export async function testDiscount(name: string, percent: number): Promise<string> {
  const [row] = await withActor(db(), systemActor('tests'), (tx) =>
    tx
      .insert(discountPreset)
      .values({ name, kind: 'percent', percent })
      .returning({ id: discountPreset.id }),
  );
  if (!row) throw new Error('The discount was not added.');
  return row.id;
}
