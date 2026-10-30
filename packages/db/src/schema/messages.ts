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
 * wa_message_id, sent_at). An outbound row comes first, as Queued; a trigger queues the
 * `whatsapp.send` job in the same transaction, and the job sends it and records the outcome. The
 * webhook (WA-02) moves it on to Delivered and Read, and stores what patients send as inbound
 * rows, Received. The Super Admin reads them and queues a test send; everything else is written
 * by the server (`system:whatsapp`).
 */
export const message = pgTable(
  'message',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** The patient it is for; none for a test send. */
    patientId: uuid('patient_id').references(() => patient.id),
    /** E.164; outbound only. */
    toPhone: text('to_phone'),
    /** E.164; inbound only. */
    fromPhone: text('from_phone'),
    kind: messageKind('kind').notNull(),
    direction: messageDirection('direction').notNull().default('outbound'),
    /**
     * The registry key (packages/schemas/src/message-templates.ts), or Meta's sample for a test;
     * outbound only, like the version and language.
     */
    templateKey: text('template_key'),
    templateVersion: smallint('template_version'),
    language: text('language'),
    /** The template's variables, by name, as sent. */
    variables: jsonb('variables').$type<Record<string, string>>().notNull().default({}),
    /** Inbound: the text, or the title of the button or list row tapped. */
    body: text('body'),
    /** Inbound: the button or list row id, or the Flow's name. */
    replyId: text('reply_id'),
    /** Inbound: a Flow's answers. */
    replyPayload: jsonb('reply_payload').$type<Record<string, unknown>>(),
    /** Inbound: Meta's id of the message of ours it replies to. */
    contextWaId: text('context_wa_id'),
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
    /** Outbound: when Meta took it; inbound: when it was sent to us. */
    sentAt: timestamp('sent_at', { withTimezone: true }),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    readAt: timestamp('read_at', { withTimezone: true }),
    statusAt: timestamp('status_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('message_created_at_idx').on(table.createdAt),
    index('message_patient_idx').on(table.patientId),
    check('message_to_phone', sql`${table.toPhone} ~ '^\\+[1-9][0-9]{7,14}$'`),
    check('message_from_phone', sql`${table.fromPhone} ~ '^\\+[1-9][0-9]{7,14}$'`),
    // Sent, Delivered and Read have Meta's id and the time Meta took it; a message never sent has
    // no id (Failed may have one: Meta took it, then could not deliver it).
    check(
      'message_accepted',
      sql`${table.status} not in ('sent', 'delivered', 'read') or (${table.waMessageId} is not null and ${table.sentAt} is not null)`,
    ),
    check(
      'message_not_sent',
      sql`${table.status} not in ('queued', 'skipped') or ${table.waMessageId} is null`,
    ),
    check(
      'message_outbound',
      sql`${table.direction} <> 'outbound' or (${table.toPhone} is not null and ${table.fromPhone} is null and ${table.templateKey} is not null and ${table.templateVersion} is not null and ${table.language} is not null and ${table.kind} in ('template', 'test') and ${table.status} <> 'received')`,
    ),
    check(
      'message_inbound',
      sql`${table.direction} <> 'inbound' or (${table.fromPhone} is not null and ${table.toPhone} is null and ${table.waMessageId} is not null and ${table.sentAt} is not null and ${table.kind} in ('text', 'reply', 'flow', 'other') and ${table.status} = 'received')`,
    ),
    check('message_test', sql`${table.kind} <> 'test' or ${table.patientId} is null`),
    check('message_attempts', sql`${table.attempts} >= 0`),
  ],
).enableRLS();

export type Message = typeof message.$inferSelect;
