import { and, eq, sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { createDb } from '../client';
import {
  clearRateLimit,
  pruneRateLimits,
  rateLimitHits,
  rateLimitKeyHash,
  recordRateLimitHit,
} from '../rate-limits';
import { rateLimit } from '../schema';

// IAM-11: rate limit counters in the database. Counts hold under concurrency, windows are fixed,
// only hashes of keys are kept, and old windows are pruned. CI database only; each test uses its
// own generated key.
const url = process.env.DIRECT_DATABASE_URL;
if (!url) throw new Error('DIRECT_DATABASE_URL is not set.');
const { db, close } = createDb(url, { max: 4 });
afterAll(close);

const bucket = 'sign_in_per_email';
const key = () => `test.${crypto.randomUUID()}@clinicmx.test`;

describe('rate limit counters', () => {
  it('count attempts in the current window and say when it ends', async () => {
    const email = key();
    expect((await rateLimitHits(db, bucket, email, 15)).hits).toBe(0);
    await recordRateLimitHit(db, bucket, email, 15);
    const second = await recordRateLimitHit(db, bucket, email, 15);
    expect(second.hits).toBe(2);
    const { hits, endsAt } = await rateLimitHits(db, bucket, email, 15);
    expect(hits).toBe(2);
    // Fixed windows of 15 minutes, on the database clock.
    expect(endsAt.getTime() % (15 * 60_000)).toBe(0);
    expect(endsAt.getTime() - Date.now()).toBeLessThanOrEqual(15 * 60_000 + 5_000);
    // Another bucket and another key count apart.
    expect((await rateLimitHits(db, 'sign_in_per_network', email, 15)).hits).toBe(0);
    expect((await rateLimitHits(db, bucket, key(), 15)).hits).toBe(0);
  });

  it('count every one of many attempts at once', async () => {
    const email = key();
    await Promise.all(Array.from({ length: 20 }, () => recordRateLimitHit(db, bucket, email, 15)));
    expect((await rateLimitHits(db, bucket, email, 15)).hits).toBe(20);
  });

  it('keep only a hash of the key, never the email', async () => {
    const email = key();
    await recordRateLimitHit(db, bucket, email, 15);
    const rows = await db
      .select({ keyHash: rateLimit.keyHash })
      .from(rateLimit)
      .where(eq(rateLimit.keyHash, rateLimitKeyHash(bucket, email)));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.keyHash).toMatch(/^[0-9a-f]{64}$/);
    const leaked = await db.execute(
      sql`select 1 from public.rate_limit where key_hash like ${`%${email}%`}`,
    );
    expect(leaked).toHaveLength(0);
  });

  it('forget a key when cleared', async () => {
    const email = key();
    await recordRateLimitHit(db, bucket, email, 15);
    await clearRateLimit(db, bucket, email);
    expect((await rateLimitHits(db, bucket, email, 15)).hits).toBe(0);
  });

  it('prune only windows older than a day', async () => {
    const old = key();
    const recent = key();
    await db.insert(rateLimit).values([
      {
        bucket,
        keyHash: rateLimitKeyHash(bucket, old),
        windowStart: new Date(Date.now() - 25 * 3_600_000),
      },
      {
        bucket,
        keyHash: rateLimitKeyHash(bucket, recent),
        windowStart: new Date(Date.now() - 23 * 3_600_000),
      },
    ]);
    expect(await pruneRateLimits(db)).toBeGreaterThanOrEqual(1);
    const left = async (k: string) =>
      db
        .select()
        .from(rateLimit)
        .where(
          and(eq(rateLimit.bucket, bucket), eq(rateLimit.keyHash, rateLimitKeyHash(bucket, k))),
        );
    expect(await left(old)).toHaveLength(0);
    expect(await left(recent)).toHaveLength(1);
  });

  it('prune every hour', async () => {
    const jobs = await db.execute<{ schedule: string }>(
      sql`select schedule from cron.job where jobname = 'rate-limit-prune'`,
    );
    expect(jobs[0]?.schedule).toBe('17 * * * *');
  });
});
