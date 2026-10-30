import { messageDirections, messageKinds, messageStatuses } from '@clinic-mx/schemas';
import { sql } from 'drizzle-orm';
import {
  check,
  index,
  jsonb,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { patient } from './patients';

export const messageKind = pgEnum('message_kind', messageKinds);
export const messageDirection = pgEnum('message_direction', messageDirections);
export const messageStatus = pgEnum('message_status', messageStatuses);

/**
 * A WhatsApp message (WA-01; TAD section 4 `message`: template_key, direction, status,
 * wa_message_id, sent_at). The row comes first, as Queued; a trigger queues the `whatsapp.send`
 * job in the same transaction, and the job sends it and records the outcome. The Super Admin reads
 * them and queues a test send; everything else is written by the server (`system:whatsapp`).
 */
export const message = pgTable(
  'message',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** The patient it is for; none for a test send. */
    patientId: uuid('patient_id').references(() => patient.id),
    /** E.164. */
    toPhone: text('to_phone').notNull(),
    kind: messageKind('kind').notNull(),
    direction: messageDirection('direction').notNull().default('outbound'),
    /** The registry key (packages/schemas/src/message-templates.ts), or Meta's sample for a test. */
    templateKey: text('template_key').notNull(),
    templateVersion: smallint('template_version').notNull(),
    language: text('language').notNull(),
    /** The template's variables, by name, as sent. */
    variables: jsonb('variables').$type<Record<string, string>>().notNull().default({}),
    status: messageStatus('status').notNull().default('queued'),
    /** Meta's message id, once sent. */
    waMessageId: text('wa_message_id').unique(),
    /** Meta's error code, or why it was not sent. */
    errorCode: text('error_code'),
    errorTitle: text('error_title'),
    attempts: smallint('attempts').notNull().default(0),
    /** Who queued it: `staff:<id>` or `system:<component>`. */
    createdBy: text('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    statusAt: timestamp('status_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('message_created_at_idx').on(table.createdAt),
    index('message_patient_idx').on(table.patientId),
    check('message_to_phone', sql`${table.toPhone} ~ '^\\+[1-9][0-9]{7,14}$'`),
    check(
      'message_sent',
      sql`(${table.status} = 'sent') = (${table.waMessageId} is not null and ${table.sentAt} is not null)`,
    ),
    check('message_test', sql`${table.kind} <> 'test' or ${table.patientId} is null`),
    check('message_attempts', sql`${table.attempts} >= 0`),
  ],
).enableRLS();

export type Message = typeof message.$inferSelect;
