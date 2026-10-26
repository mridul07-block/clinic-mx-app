import {
  UNSIGNED_NOTES_FLAG_JOB,
  auditEvent,
  consultation,
  createDb,
  job,
  latestKnowledgeVersion,
  systemActor,
  task,
  treatmentSession,
  withActor,
} from '@clinic-mx/db';
import { UNSIGNED_NOTES_TASK, addDays } from '@clinic-mx/schemas';
import { and, eq, inArray, sql } from 'drizzle-orm';

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

/**
 * A draft note on a started visit (CLN-10): the visit's consultation, or its session note, opened
 * and left unsigned, as Start consultation and Start session leave them.
 */
export async function draftNote(
  kind: 'consultation' | 'session',
  visit: { appointmentId: string; episodeId: string; physioId: string },
): Promise<void> {
  await withActor(db(), systemActor('tests'), async (tx) => {
    const version = await latestKnowledgeVersion(tx);
    if (!version) throw new Error('The knowledge base is not imported.');
    if (kind === 'consultation') {
      await tx.insert(consultation).values({
        appointmentId: visit.appointmentId,
        episodeId: visit.episodeId,
        physioId: visit.physioId,
        kbVersionId: version.id,
        sections: {},
      });
    } else {
      await tx.insert(treatmentSession).values({
        appointmentId: visit.appointmentId,
        physioId: visit.physioId,
        kbVersionId: version.id,
        episodeId: sql`null`,
        patientId: sql`null`,
        centreId: sql`null`,
        number: 1,
        note: {},
      });
    }
  });
}

/** Queues the unsigned notes flag for a night, due now (CLN-10). */
export async function unsignedNotesFlagDueNow(date: string): Promise<void> {
  await withActor(db(), systemActor('tests'), (tx) =>
    tx.insert(job).values({
      kind: UNSIGNED_NOTES_FLAG_JOB,
      payload: { date },
      runAt: new Date(),
      idempotencyKey: [UNSIGNED_NOTES_FLAG_JOB, date].join(':'),
    }),
  );
}

/** Removes the flag's tasks and jobs for a night (and the next night it queued). */
export async function removeUnsignedNotesFlag(date: string): Promise<void> {
  await withActor(db(), systemActor('tests'), async (tx) => {
    await tx
      .delete(task)
      .where(and(eq(task.kind, UNSIGNED_NOTES_TASK), sql`${task.details} ->> 'date' = ${date}`));
    await tx.delete(job).where(
      inArray(
        job.idempotencyKey,
        [date, addDays(date, 1)].map((night) => [UNSIGNED_NOTES_FLAG_JOB, night].join(':')),
      ),
    );
  });
}
