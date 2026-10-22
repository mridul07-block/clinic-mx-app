import { createHash } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { rateLimit } from './schema';
import type { DbOrTransaction } from './versioned';

/**
 * Rate limit counters (IAM-11): fixed windows of `minutes`, counted per bucket and key. Only the
 * sha256 of `bucket:key` is stored. Server only, on the owner connection.
 */

/** What the table keeps of a key: never the email or address itself. */
export function rateLimitKeyHash(bucket: string, key: string): string {
  return createHash('sha256').update(`${bucket}:${key}`).digest('hex');
}

/** The start of the current window, from the database clock. */
const windowStart = (minutes: number) =>
  sql`to_timestamp(floor(extract(epoch from now()) / ${minutes * 60}) * ${minutes * 60})`;

export interface RateLimitWindow {
  hits: number;
  /** When the current window ends and the count starts again. */
  endsAt: Date;
}

const windowOf = async (db: DbOrTransaction, minutes: number) => {
  const rows = await db.execute<{ start: Date | string }>(
    sql`select ${windowStart(minutes)} as start`,
  );
  const start = new Date(rows[0]?.start ?? Date.now());
  return { start, endsAt: new Date(start.getTime() + minutes * 60_000) };
};

/** Hits in the current window for a bucket and key. */
export async function rateLimitHits(
  db: DbOrTransaction,
  bucket: string,
  key: string,
  minutes: number,
): Promise<RateLimitWindow> {
  const { start, endsAt } = await windowOf(db, minutes);
  const [row] = await db
    .select({ hits: rateLimit.hits })
    .from(rateLimit)
    .where(
      and(
        eq(rateLimit.bucket, bucket),
        eq(rateLimit.keyHash, rateLimitKeyHash(bucket, key)),
        eq(rateLimit.windowStart, start),
      ),
    );
  return { hits: row?.hits ?? 0, endsAt };
}

/** Counts one attempt in the current window; returns the count with it. Safe under concurrency. */
export async function recordRateLimitHit(
  db: DbOrTransaction,
  bucket: string,
  key: string,
  minutes: number,
): Promise<RateLimitWindow> {
  const { start, endsAt } = await windowOf(db, minutes);
  const [row] = await db
    .insert(rateLimit)
    .values({ bucket, keyHash: rateLimitKeyHash(bucket, key), windowStart: start, hits: 1 })
    .onConflictDoUpdate({
      target: [rateLimit.bucket, rateLimit.keyHash, rateLimit.windowStart],
      set: { hits: sql`${rateLimit.hits} + 1` },
    })
    .returning({ hits: rateLimit.hits });
  return { hits: row?.hits ?? 1, endsAt };
}

/** Forgets every count for a bucket and key, for example after a successful sign in. */
export async function clearRateLimit(
  db: DbOrTransaction,
  bucket: string,
  key: string,
): Promise<void> {
  await db
    .delete(rateLimit)
    .where(and(eq(rateLimit.bucket, bucket), eq(rateLimit.keyHash, rateLimitKeyHash(bucket, key))));
}

/** Deletes windows older than a day (the hourly pg_cron job runs the same function). */
export async function pruneRateLimits(db: DbOrTransaction): Promise<number> {
  const rows = await db.execute<{ gone: number }>(sql`select internal.prune_rate_limits() as gone`);
  return rows[0]?.gone ?? 0;
}
