import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

/**
 * Background jobs (FND-10, TAD section 8). pg_cron calls /api/jobs/tick every minute; the tick
 * claims due jobs with FOR UPDATE SKIP LOCKED, runs them and retries failures with backoff. A job
 * that fails its last attempt becomes a task for the Super Admin. Domain events enqueue jobs in
 * the same transaction as the change that causes them.
 */

export const jobStatuses = ['queued', 'running', 'done', 'failed'] as const;
export const jobStatus = pgEnum('job_status', jobStatuses);

export const job = pgTable(
  'job',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Which handler runs it, for example "whatsapp.reminder.day_before". */
    kind: text('kind').notNull(),
    /** Ids and options only; handlers load what they need (no patient details in the queue). */
    payload: jsonb('payload').notNull().default({}),
    runAt: timestamp('run_at', { withTimezone: true }).notNull().defaultNow(),
    status: jobStatus('status').notNull().default('queued'),
    attempts: integer('attempts').notNull().default(0),
    /** Enqueuing twice with the same key creates one job. */
    idempotencyKey: text('idempotency_key').unique(),
    lastError: text('last_error'),
    claimedAt: timestamp('claimed_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // The tick's query: queued jobs that are due, oldest first.
    index('job_due_idx')
      .on(table.runAt)
      .where(sql`${table.status} = 'queued'`),
    check('job_attempts_not_negative', sql`${table.attempts} >= 0`),
  ],
).enableRLS();

export type Job = typeof job.$inferSelect;
