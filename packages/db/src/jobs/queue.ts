import { and, eq, inArray, lt, lte, sql } from 'drizzle-orm';
import { setAuditContext, systemActor } from '../audit';
import { job, task, type Job } from '../schema';
import type { DbOrTransaction } from '../versioned';

/**
 * The job queue (FND-10, TAD section 8). Runs are at least once: a job may run again after a
 * crash, so every handler must be safe to repeat (idempotent).
 */

/** TAD section 8: a job gets 5 attempts, then becomes a task for the Super Admin. */
export const MAX_JOB_ATTEMPTS = 5;
/** A running job not finished within this time is treated as a failed attempt. */
export const JOB_LEASE_MINUTES = 10;

/** Wait before attempt n + 1 after n failed attempts: 1, 2, 4, 8 minutes, at most an hour. */
export function retryDelayMinutes(failedAttempts: number): number {
  return Math.min(2 ** Math.max(failedAttempts - 1, 0), 60);
}

export interface EnqueueOptions {
  kind: string;
  /** Ids and options only, never patient names or phone numbers. */
  payload?: Record<string, unknown>;
  runAt?: Date;
  /** A second enqueue with the same key is ignored. */
  idempotencyKey?: string;
}

/**
 * Adds a job. Call it inside the transaction of the change that causes the job, so both commit
 * or neither does. Returns the job id, or null if a job with the same idempotency key exists.
 */
export async function enqueueJob(db: DbOrTransaction, options: EnqueueOptions) {
  const [row] = await db
    .insert(job)
    .values({
      kind: options.kind,
      payload: options.payload ?? {},
      runAt: options.runAt ?? sql`now()`,
      idempotencyKey: options.idempotencyKey,
    })
    .onConflictDoNothing({ target: job.idempotencyKey })
    .returning({ id: job.id });
  return row?.id ?? null;
}

/**
 * Claims up to `limit` due jobs for this tick. FOR UPDATE SKIP LOCKED lets ticks that overlap
 * take different jobs instead of waiting for or repeating each other's. The due ids are read
 * first, then only those still queued are marked running: in one `update ... where id in
 * (select ... skip locked)` statement Postgres may run the select again while re-checking a row
 * another tick changed, and claim more than `limit` (seen once in the local gate, 25 October
 * 2026). Both run in one transaction (a savepoint inside the caller's), so the locks hold until
 * the jobs are marked; only jobs still queued are marked, so none is ever claimed twice.
 */
export async function claimJobs(db: DbOrTransaction, limit: number): Promise<Job[]> {
  return db.transaction(async (tx) => {
    const due = await tx
      .select({ id: job.id })
      .from(job)
      .where(and(eq(job.status, 'queued'), lte(job.runAt, sql`now()`)))
      .orderBy(job.runAt)
      .limit(limit)
      .for('update', { skipLocked: true });
    return markRunning(tx, due);
  });
}

/**
 * Claims the due jobs with these idempotency keys, to run now rather than at the next tick (a
 * WhatsApp reply, WA-03). Locked and marked as `claimJobs` does, so a tick at the same time skips
 * them, and one claimed already is left alone: none runs twice. Returned in the keys' order.
 */
export async function claimJobsByKey(db: DbOrTransaction, keys: readonly string[]): Promise<Job[]> {
  if (keys.length === 0) return [];
  const claimed = await db.transaction(async (tx) => {
    const due = await tx
      .select({ id: job.id })
      .from(job)
      .where(
        and(
          inArray(job.idempotencyKey, [...keys]),
          eq(job.status, 'queued'),
          lte(job.runAt, sql`now()`),
        ),
      )
      .for('update', { skipLocked: true });
    return markRunning(tx, due);
  });
  const order = (row: Job) => keys.indexOf(row.idempotencyKey ?? '');
  return claimed.sort((a, b) => order(a) - order(b));
}

/** Marks locked due jobs running, one more attempt; only those still queued. */
async function markRunning(tx: DbOrTransaction, due: { id: string }[]): Promise<Job[]> {
  if (due.length === 0) return [];
  return tx
    .update(job)
    .set({
      status: 'running',
      attempts: sql`${job.attempts} + 1`,
      claimedAt: sql`now()`,
      updatedAt: sql`now()`,
    })
    .where(
      and(
        inArray(
          job.id,
          due.map((row) => row.id),
        ),
        eq(job.status, 'queued'),
      ),
    )
    .returning();
}

export async function completeJob(db: DbOrTransaction, id: string): Promise<void> {
  await db
    .update(job)
    .set({ status: 'done', finishedAt: sql`now()`, updatedAt: sql`now()`, lastError: null })
    .where(and(eq(job.id, id), eq(job.status, 'running')));
}

/** A short, safe description of what went wrong: the error's name and message only. */
export function describeError(error: unknown): string {
  const text = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return text.slice(0, 500);
}

/**
 * Records a failed attempt. Before the last attempt the job is queued again after a growing
 * pause; after it the job fails and, in the same transaction, a task asks the Super Admin to
 * look at it.
 */
export async function failJob(db: DbOrTransaction, failed: Job, error: unknown): Promise<void> {
  const lastError = describeError(error);
  if (failed.attempts < MAX_JOB_ATTEMPTS) {
    const minutes = retryDelayMinutes(failed.attempts);
    await db
      .update(job)
      .set({
        status: 'queued',
        runAt: sql`now() + make_interval(mins => ${minutes})`,
        lastError,
        claimedAt: null,
        updatedAt: sql`now()`,
      })
      .where(eq(job.id, failed.id));
    return;
  }
  await db.transaction(async (tx) => {
    await setAuditContext(tx, { actor: systemActor('jobs') });
    await tx
      .update(job)
      .set({ status: 'failed', lastError, finishedAt: sql`now()`, updatedAt: sql`now()` })
      .where(eq(job.id, failed.id));
    await tx.insert(task).values({
      kind: 'job.failed',
      title: `Background job "${failed.kind}" failed ${failed.attempts} times`,
      details: { jobId: failed.id, kind: failed.kind, attempts: failed.attempts, lastError },
      priority: 'high',
      assigneeRole: 'super_admin',
    });
  });
}

/** Running jobs whose lease ran out (the function crashed or timed out). */
export async function staleJobs(db: DbOrTransaction): Promise<Job[]> {
  return db
    .select()
    .from(job)
    .where(
      and(
        eq(job.status, 'running'),
        lt(job.claimedAt, sql`now() - make_interval(mins => ${JOB_LEASE_MINUTES})`),
      ),
    );
}
