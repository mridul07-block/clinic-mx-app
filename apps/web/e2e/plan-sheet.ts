import {
  createDb,
  packageType,
  packageTypeItem,
  planModality,
  planOfCare,
  priceItem,
  systemActor,
  withActor,
} from '@clinic-mx/db';
import { eq } from 'drizzle-orm';

// The plan and payment sheet for end to end tests (BIL-01): a priced modality on a signed
// consultation's plan, and a package type covering a session item. Generated
// names only ("E2E"), removed with the prices snapshot.

let database: ReturnType<typeof createDb> | undefined;
const db = () => {
  const url = process.env.DIRECT_DATABASE_URL;
  if (!url) throw new Error('DIRECT_DATABASE_URL is not set.');
  database ??= createDb(url, { max: 1, idleTimeoutSeconds: 1 });
  return database.db;
};

/** Plans a modality on the consultation's plan of care, as signing writes it. */
export async function plannedModality(consultationId: string, modalityKey: string): Promise<void> {
  await withActor(db(), systemActor('tests'), async (tx) => {
    const [plan] = await tx
      .select({ id: planOfCare.id })
      .from(planOfCare)
      .where(eq(planOfCare.consultationId, consultationId));
    if (!plan) throw new Error('The consultation has no plan of care.');
    await tx.insert(planModality).values({ planOfCareId: plan.id, modalityKey, reason: '' });
  });
}

/** A package type covering one price item, by its key; its name starts with "E2E". */
export async function testPackage(values: {
  name: string;
  sessions: number;
  pricePaise: number;
  itemKey: string;
}): Promise<void> {
  await withActor(db(), systemActor('tests'), async (tx) => {
    const [item] = await tx
      .select({ id: priceItem.id })
      .from(priceItem)
      .where(eq(priceItem.key, values.itemKey));
    if (!item) throw new Error(`No price item ${values.itemKey}`);
    const [created] = await tx
      .insert(packageType)
      .values({ name: values.name, sessions: values.sessions, pricePaise: values.pricePaise })
      .returning({ id: packageType.id });
    if (!created) throw new Error('The package type was not added.');
    await tx.insert(packageTypeItem).values({ packageTypeId: created.id, priceItemId: item.id });
  });
}
