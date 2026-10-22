import { check, integer, pgTable, primaryKey, text, timestamp } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

/**
 * Rate limit counters (IAM-11, TAD section 8): one row per bucket, key and fixed window. The key
 * is the sha256 of the bucket and the identifier (an email, a network address, a login), never
 * the identifier itself. Server only: no policy, no audit trigger (counters would bury the real
 * events). An hourly pg_cron job deletes windows older than a day.
 */
export const rateLimit = pgTable(
  'rate_limit',
  {
    bucket: text('bucket').notNull(),
    keyHash: text('key_hash').notNull(),
    windowStart: timestamp('window_start', { withTimezone: true }).notNull(),
    hits: integer('hits').notNull().default(1),
  },
  (table) => [
    primaryKey({ columns: [table.bucket, table.keyHash, table.windowStart] }),
    check('rate_limit_key_hash', sql`${table.keyHash} ~ '^[0-9a-f]{64}$'`),
    check('rate_limit_hits', sql`${table.hits} > 0`),
  ],
).enableRLS();
