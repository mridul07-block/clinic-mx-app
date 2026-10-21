import type { z } from 'zod';
import type { Db } from '../client';
import type { Job } from '../schema';
import { claimJobs, completeJob, failJob, staleJobs } from './queue';

/** What runs one kind of job: its payload schema and the work. Must be safe to repeat. */
export interface JobHandler<S extends z.ZodType = z.ZodType> {
  payload: S;
  run: (payload: z.infer<S>, context: { db: Db; job: Job }) => Promise<void>;
}

export type JobHandlers = Readonly<Record<string, JobHandler>>;

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
    for (const claimed of batch) {
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
  }
  return result;
}
