import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb } from '../client';
import { MAX_JOB_ATTEMPTS, claimJobs, enqueueJob, failJob, retryDelayMinutes } from '../jobs/queue';
import { runDueJobs, type JobHandlers } from '../jobs/runner';
import { job, task } from '../schema';

// Runs against the CI database only (FND-10 done when: jobs claimed with skip locked; 5 retries
// then a Super Admin task).
const url = process.env.DIRECT_DATABASE_URL;
if (!url) throw new Error('DIRECT_DATABASE_URL is not set.');
const first = createDb(url, { max: 1 });
const second = createDb(url, { max: 1 });

afterAll(async () => {
  await Promise.all([first.close(), second.close()]);
});

beforeEach(async () => {
  await first.db.delete(task).where(eq(task.kind, 'job.failed'));
  await first.db.delete(job);
});

const due = (kind: string, n: number) =>
  Promise.all(Array.from({ length: n }, () => enqueueJob(first.db, { kind })));

/** Makes every queued job due now, as if its retry pause had passed. */
const makeDue = () =>
  first.db
    .update(job)
    .set({ runAt: sql`now()` })
    .where(eq(job.status, 'queued'));

const ok: JobHandlers = {
  'test.ok': { payload: z.object({}), run: () => Promise.resolve() },
  'test.fails': {
    payload: z.object({}),
    run: () => Promise.reject(new Error('Provider unavailable')),
  },
  'test.needs-id': { payload: z.object({ id: z.uuid() }), run: () => Promise.resolve() },
};

describe('enqueueJob', () => {
  it('creates one job per idempotency key', async () => {
    const a = await enqueueJob(first.db, { kind: 'test.ok', idempotencyKey: 'reminder:42' });
    const b = await enqueueJob(first.db, { kind: 'test.ok', idempotencyKey: 'reminder:42' });
    expect(a).not.toBeNull();
    expect(b).toBeNull();
    expect(await first.db.$count(job)).toBe(1);
  });

  it('commits or rolls back with the change that caused it', async () => {
    await first.db
      .transaction(async (tx) => {
        await enqueueJob(tx, { kind: 'test.ok' });
        throw new Error('the booking failed');
      })
      .catch(() => undefined);
    expect(await first.db.$count(job)).toBe(0);
  });
});

describe('claimJobs', () => {
  it('lets two overlapping ticks take different jobs without waiting (SKIP LOCKED)', async () => {
    await due('test.ok', 20);
    const [held, other] = await first.db.transaction(async (tx) => {
      // This tick holds its 10 jobs locked until the transaction ends...
      const mine = await claimJobs(tx, 10);
      // ...while a second tick, on another connection, claims at the same moment.
      const theirs = await claimJobs(second.db, 10);
      return [mine, theirs];
    });
    expect(held).toHaveLength(10);
    expect(other).toHaveLength(10);
    const ids = new Set([...held, ...other].map((j) => j.id));
    expect(ids.size).toBe(20);
  });

  it('leaves jobs that are not due yet', async () => {
    await enqueueJob(first.db, { kind: 'test.ok', runAt: new Date(Date.now() + 3_600_000) });
    expect(await claimJobs(first.db, 10)).toEqual([]);
  });

  it('marks claimed jobs running and counts the attempt', async () => {
    await due('test.ok', 1);
    const [claimed] = await claimJobs(first.db, 10);
    expect(claimed).toMatchObject({ status: 'running', attempts: 1 });
    expect(claimed?.claimedAt).toBeInstanceOf(Date);
  });
});

describe('retries', () => {
  it('waits longer after each failure', () => {
    expect([1, 2, 3, 4, 5, 10].map(retryDelayMinutes)).toEqual([1, 2, 4, 8, 16, 60]);
  });

  it('queues a failed job again after a pause, keeping the error', async () => {
    await due('test.fails', 1);
    const [claimed] = await claimJobs(first.db, 1);
    if (!claimed) throw new Error('no job');
    await failJob(first.db, claimed, new Error('Provider unavailable'));
    const [row] = await first.db
      .select({
        status: job.status,
        attempts: job.attempts,
        lastError: job.lastError,
        waitSeconds: sql<number>`extract(epoch from ${job.runAt} - now())::int`,
      })
      .from(job);
    expect(row).toMatchObject({
      status: 'queued',
      attempts: 1,
      lastError: 'Error: Provider unavailable',
    });
    expect(row?.waitSeconds).toBeGreaterThan(50);
    expect(row?.waitSeconds).toBeLessThanOrEqual(60);
  });

  it(`gives up after ${MAX_JOB_ATTEMPTS} attempts and creates one task for the Super Admin`, async () => {
    await due('test.fails', 1);
    for (let attempt = 1; attempt <= MAX_JOB_ATTEMPTS; attempt++) {
      await makeDue();
      expect(await runDueJobs(first.db, ok)).toMatchObject({ claimed: 1, failed: 1 });
    }
    const [failed] = await first.db.select().from(job);
    expect(failed).toMatchObject({ status: 'failed', attempts: MAX_JOB_ATTEMPTS });

    await makeDue();
    expect((await runDueJobs(first.db, ok)).claimed).toBe(0);

    const tasks = await first.db.select().from(task).where(eq(task.kind, 'job.failed'));
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({
      assigneeRole: 'super_admin',
      status: 'open',
      priority: 'high',
      details: { jobId: failed?.id, kind: 'test.fails', attempts: 5 },
    });
  });
});

describe('runDueJobs', () => {
  it('runs due jobs and marks them done', async () => {
    await due('test.ok', 3);
    expect(await runDueJobs(first.db, ok)).toEqual({ claimed: 3, done: 3, failed: 0, timedOut: 0 });
    const statuses = await first.db.select({ status: job.status }).from(job);
    expect(statuses.every((s) => s.status === 'done')).toBe(true);
  });

  it('retries a job with no handler or an invalid payload', async () => {
    await enqueueJob(first.db, { kind: 'test.unknown' });
    await enqueueJob(first.db, { kind: 'test.needs-id', payload: { id: 'not-a-uuid' } });
    expect(await runDueJobs(first.db, ok)).toMatchObject({ claimed: 2, failed: 2 });
    const queued = await first.db.select().from(job).where(eq(job.status, 'queued'));
    expect(queued).toHaveLength(2);
  });

  it('counts a job left running past its lease as a failed attempt', async () => {
    await due('test.ok', 1);
    await claimJobs(first.db, 1);
    await first.db.update(job).set({ claimedAt: sql`now() - interval '11 minutes'` });
    expect((await runDueJobs(first.db, ok)).timedOut).toBe(1);
    const [row] = await first.db.select().from(job);
    expect(row).toMatchObject({ status: 'queued', attempts: 1 });
    expect(row?.lastError).toContain('lease');
  });
});

describe('pg_cron tick', () => {
  it('is scheduled every minute', async () => {
    const rows = await first.db.execute<{ schedule: string; command: string }>(
      sql`select schedule, command from cron.job where jobname = 'jobs-tick'`,
    );
    expect(rows[0]).toEqual({ schedule: '* * * * *', command: 'SELECT internal.jobs_tick()' });
  });

  it('does nothing until the tick URL and secret are in Vault', async () => {
    const rows = await first.db.execute<{ request: string | null }>(
      sql`select internal.jobs_tick() as request`,
    );
    expect(rows[0]?.request).toBeNull();
  });

  it('cannot be called through the Supabase API roles', async () => {
    for (const role of ['anon', 'authenticated']) {
      const denied = await first.db
        .transaction(async (tx) => {
          await tx.execute(sql`select set_config('role', ${role}, true)`);
          await tx.execute(sql`select internal.jobs_tick()`);
          return false;
        })
        .catch(() => true);
      expect(denied).toBe(true);
    }
  });
});
