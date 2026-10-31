import type { z } from 'zod';
import type { Db } from '../client';
import type { Job } from '../schema';
import { claimJobs, claimJobsByKey, completeJob, failJob, staleJobs } from './queue';

/** What runs one kind of job: its payload schema and the work. Must be safe to repeat. */
export interface JobHandler<S extends z.ZodType = z.ZodType> {
  payload: S;
  run: (payload: z.infer<S>, context: { db: Db; job: Job }) => Promise<void>;
}

export type JobHandlers = Readonly<Record<string, JobHandler>>;

/**
 * A handler whose work reads its payload as its schema gives it. Safe to widen: the tick parses
 * every payload with the handler's own schema before running it.
 */
export function defineJob<S extends z.ZodType>(handler: JobHandler<S>): JobHandler {
  return handler;
}

export interface TickResult {
  claimed: number;
  done: number;
  failed: number;
  timedOut: number;
}

export interface TickOptions {
  /** Jobs claimed per batch. */
  batchSize?: number;
  /** Stop claiming new batches after this long, leaving room within the function time limit. */
  budgetMs?: number;
  now?: () => number;
}

/**
 * One tick: counts running jobs that outlived their lease as failed attempts, then claims and
 * runs due jobs in batches until none are left or the time budget is spent.
 */
export async function runDueJobs(
  db: Db,
  handlers: JobHandlers,
  { batchSize = 10, budgetMs = 40_000, now = Date.now }: TickOptions = {},
): Promise<TickResult> {
  const started = now();
  const result: TickResult = { claimed: 0, done: 0, failed: 0, timedOut: 0 };

  for (const stale of await staleJobs(db)) {
    await failJob(db, stale, new Error('Timed out: still running when its lease ran out'));
    result.timedOut++;
  }

  while (now() - started < budgetMs) {
    const batch = await claimJobs(db, batchSize);
    if (batch.length === 0) break;
    result.claimed += batch.length;
    for (const claimed of batch) await runClaimed(db, handlers, claimed, result);
  }
  return result;
}

/**
 * Runs the due jobs with these idempotency keys now, in the keys' order, rather than at the next
 * tick (a WhatsApp reply, WA-03): claimed, run, then done or failed exactly as a tick would, so a
 * failure is tried again by the tick with its backoff. One not due, or claimed already, is left.
 */
export async function runJobsNow(
  db: Db,
  handlers: JobHandlers,
  keys: readonly string[],
): Promise<TickResult> {
  const result: TickResult = { claimed: 0, done: 0, failed: 0, timedOut: 0 };
  const claimed = await claimJobsByKey(db, keys);
  result.claimed = claimed.length;
  for (const one of claimed) await runClaimed(db, handlers, one, result);
  return result;
}

async function runClaimed(
  db: Db,
  handlers: JobHandlers,
  claimed: Job,
  result: TickResult,
): Promise<void> {
  try {
    const handler = handlers[claimed.kind];
    if (!handler) throw new Error(`No handler for job kind "${claimed.kind}"`);
    await handler.run(handler.payload.parse(claimed.payload), { db, job: claimed });
    await completeJob(db, claimed.id);
    result.done++;
  } catch (error) {
    await failJob(db, claimed, error);
    result.failed++;
  }
}
