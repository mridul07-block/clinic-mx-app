import { sql } from 'drizzle-orm';
import { check, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { staffUser } from './identity';

/**
 * Velyx support access grants (IAM-08, TAD section 4). The Super Admin grants support access from
 * now until `ends_at`, with a reason; ending it early moves `ends_at` to that moment. A grant is
 * active while `starts_at <= now() < ends_at`. Audited like every table: who granted and who
 * ended it are in the audit trail.
 */
export const supportGrant = pgTable(
  'support_grant',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    grantedBy: uuid('granted_by')
      .notNull()
      .references(() => staffUser.id),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull().defaultNow(),
    endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
    reason: text('reason').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('support_grant_ends_at_idx').on(table.endsAt),
    check('support_grant_window', sql`${table.endsAt} > ${table.startsAt}`),
    check('support_grant_reason', sql`length(trim(${table.reason})) > 0`),
  ],
).enableRLS();

export type SupportGrant = typeof supportGrant.$inferSelect;
