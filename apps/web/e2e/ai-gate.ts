import { createDb, setting, systemActor, withActor } from '@clinic-mx/db';
import { eq } from 'drizzle-orm';

// The AI preparation sheet switch for the AI-09 test: put back to off, as the migration left it,
// before and after the test switches it.

let database: ReturnType<typeof createDb> | undefined;
const db = () => {
  const url = process.env.DIRECT_DATABASE_URL;
  if (!url) throw new Error('DIRECT_DATABASE_URL is not set.');
  database ??= createDb(url, { max: 1, idleTimeoutSeconds: 1 });
  return database.db;
};

export async function aiSheetOff(): Promise<void> {
  await withActor(db(), systemActor('tests'), (tx) =>
    tx
      .update(setting)
      .set({ value: { on: false } })
      .where(eq(setting.key, 'ai.preparation_sheet')),
  );
}

/** Switched on for the live knowledge base version, as the Super Admin would with both records. */
export async function aiSheetOn(version: { id: string; number: number }): Promise<void> {
  await withActor(db(), systemActor('tests'), (tx) =>
    tx
      .update(setting)
      .set({
        value: {
          on: true,
          blindTest: { date: '2026-10-20', reference: 'E2E blind test' },
          legalCheck: { date: '2026-10-21', reference: 'E2E legal check' },
          since: new Date().toISOString(),
          kbVersionId: version.id,
          kbVersionNumber: version.number,
        },
      })
      .where(eq(setting.key, 'ai.preparation_sheet')),
  );
}
