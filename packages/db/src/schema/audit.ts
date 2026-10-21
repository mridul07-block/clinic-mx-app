import { sql } from 'drizzle-orm';
import {
  bigserial,
  check,
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';

/**
 * The audit trail (FND-11, rule 5, TAD section 5). A trigger on every audited table writes one
 * row per change, in the same transaction, with the actor, the row before and after. Record views
 * are written by `logRecordView`. Rows are never changed or deleted.
 */

// sign_in, sign_out and password_change record staff access (IAM-01); two_step_on and
// two_step_reset record two step verification turned on or reset by the Super Admin (IAM-02);
// staff_invited and invite_link_created record invites sent and links made (IAM-06);
// support_request records each page or action a Velyx support login asks for under a grant
// (IAM-08). None of them changes a table row.
export const auditActions = [
  'insert',
  'update',
  'delete',
  'view',
  'sign_in',
  'sign_out',
  'password_change',
  'two_step_on',
  'two_step_reset',
  'staff_invited',
  'invite_link_created',
  'support_request',
] as const;
export const auditAction = pgEnum('audit_action', auditActions);

export const auditEvent = pgTable(
  'audit_event',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    /** Who: `staff:<uuid>`, `patient:<uuid>` (a patient link) or `system:<component>`. */
    actor: text('actor').notNull(),
    action: auditAction('action').notNull(),
    /** The table, for example "staff_user". */
    entity: text('entity').notNull(),
    /** The row's id; null for rows keyed by several columns. */
    entityId: text('entity_id'),
    before: jsonb('before'),
    after: jsonb('after'),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
    ip: text('ip'),
  },
  (table) => [
    index('audit_event_entity_idx').on(table.entity, table.entityId, table.at),
    index('audit_event_actor_idx').on(table.actor, table.at),
    check(
      'audit_event_actor_format',
      sql`${table.actor} ~ '^(staff|patient):[0-9a-f-]{36}$|^system:[a-z0-9._-]+$'`,
    ),
  ],
).enableRLS();

export type AuditEvent = typeof auditEvent.$inferSelect;
