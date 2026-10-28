import { createDb, kbVersion, latestKnowledgeVersion, systemActor, withActor } from '@clinic-mx/db';
import { eq, sql } from 'drizzle-orm';

// The knowledge base version for the approval test (SET-06). CI has one version, the import, so
// approving it never changes which version is live and other tests carry on. The test puts it
// back to a draft before and after: test harness only, on the owner connection, with the guard
// off for that one transaction (nobody else ever changes an approved version).

let database: ReturnType<typeof createDb> | undefined;
const db = () => {
  const url = process.env.DIRECT_DATABASE_URL;
  if (!url) throw new Error('DIRECT_DATABASE_URL is not set.');
  database ??= createDb(url, { max: 1, idleTimeoutSeconds: 1 });
  return database.db;
};

/** The live version's id and number; the test approves this one. */
export async function liveVersion(): Promise<{ id: string; number: number }> {
  const version = await db().transaction((tx) => latestKnowledgeVersion(tx));
  if (!version) throw new Error('The knowledge base is not imported.');
  return { id: version.id, number: version.number };
}

/** Puts the version back to a draft, as the import left it. */
export async function backToDraft(id: string): Promise<void> {
  await withActor(db(), systemActor('tests'), async (tx) => {
    await tx.execute(sql`alter table public.kb_version disable trigger kb_version_guard`);
    await tx
      .update(kbVersion)
      .set({ status: 'draft', approvedBy: null, approvedAt: null, notes: null })
      .where(eq(kbVersion.id, id));
    await tx.execute(sql`alter table public.kb_version enable trigger kb_version_guard`);
  });
}
