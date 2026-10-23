import { auditEvent, createDb, systemActor, task, withActor } from '@clinic-mx/db';
import { and, eq, inArray } from 'drizzle-orm';

// Tasks for the inbox tests (ALT-03), made as the system the way the server makes them.

let database: ReturnType<typeof createDb> | undefined;
const db = () => {
  const url = process.env.DIRECT_DATABASE_URL;
  if (!url) throw new Error('DIRECT_DATABASE_URL is not set.');
  database ??= createDb(url, { max: 1, idleTimeoutSeconds: 1 });
  return database.db;
};

export const TEST_TASK_KIND = 'e2e.test';

export async function makeTasks(rows: (Partial<typeof task.$inferInsert> & { title: string })[]) {
  return withActor(db(), systemActor('tests'), (tx) =>
    tx
      .insert(task)
      .values(rows.map((row) => ({ kind: TEST_TASK_KIND, ...row })))
      .returning({ id: task.id, title: task.title }),
  );
}

export async function removeTasks(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await withActor(db(), systemActor('tests'), (tx) =>
    tx.delete(task).where(and(inArray(task.id, ids), eq(task.kind, TEST_TASK_KIND))),
  );
}

/** The task as stored, and who changed it, for the audit check. */
export async function taskTrail(id: string) {
  const [row] = await db().select().from(task).where(eq(task.id, id));
  const audit = await db()
    .select({ actor: auditEvent.actor, action: auditEvent.action })
    .from(auditEvent)
    .where(and(eq(auditEvent.entity, 'task'), eq(auditEvent.entityId, id)));
  return { row, audit };
}
