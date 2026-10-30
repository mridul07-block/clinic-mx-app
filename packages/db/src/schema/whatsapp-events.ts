import { index, jsonb, pgTable, timestamp, uuid } from 'drizzle-orm/pg-core';

/**
 * A webhook body from Meta, kept as it came once its signature checked out (WA-02; TAD section
 * 6). Inserting one queues its `whatsapp.event` job; the job stores the statuses and messages in
 * it on `message` and marks it handled. Server only: no policy, so no staff member reads or writes
 * it, and no audit trigger (the messages it becomes are audited; a copy of the raw body in the
 * audit log would outlive the deletion). An hourly pg_cron job deletes handled ones older than
 * `whatsapp.event_retention_days` (user decision, 30 October 2026: 7 days).
 */
export const whatsappEvent = pgTable(
  'whatsapp_event',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
    payload: jsonb('payload').$type<unknown>().notNull(),
    processedAt: timestamp('processed_at', { withTimezone: true }),
  },
  (table) => [index('whatsapp_event_processed_at_idx').on(table.processedAt)],
).enableRLS();

export type WhatsappEvent = typeof whatsappEvent.$inferSelect;
