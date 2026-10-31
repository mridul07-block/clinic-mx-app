import {
  inboundRoutes,
  messageDirections,
  messageKinds,
  messageStatuses,
} from '@clinic-mx/schemas';
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
import { appointment } from './appointments';
import { staffUser } from './identity';
import { patientLink } from './patient-links';
import { patient } from './patients';

export const messageKind = pgEnum('message_kind', messageKinds);
export const messageDirection = pgEnum('message_direction', messageDirections);
export const messageStatus = pgEnum('message_status', messageStatuses);
export const messageRoute = pgEnum('message_route', inboundRoutes);

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
    /**
     * Inbound: Meta's id of the message of ours it replies to. Outbound (a router reply, WA-03):
     * the id of the message it answers.
     */
    contextWaId: text('context_wa_id'),
    /** Inbound: where the conversation router sent it (WA-03), and when. */
    route: messageRoute('route'),
    routedAt: timestamp('routed_at', { withTimezone: true }),
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
    /**
     * WA-06: the patient link a check's message stands for (the first treatment check, a follow
     * up), so a tap on its reply button is recorded as that link's answer.
     */
    patientLinkId: uuid('patient_link_id').references(() => patientLink.id),
    /** WA-06: the job that queued it, so a job that runs again queues nothing more. */
    sourceKey: text('source_key').unique(),
    /**
     * WA-08: the appointment a reminder is about, so a tap on its Confirm confirms that one (a
     * family on one number gets one reminder per appointment).
     */
    appointmentId: uuid('appointment_id').references(() => appointment.id, {
      onDelete: 'set null',
    }),
  },
  (table) => [
    index('message_created_at_idx').on(table.createdAt),
    index('message_patient_idx').on(table.patientId),
    index('message_patient_link_idx')
      .on(table.patientLinkId)
      .where(sql`${table.patientLinkId} is not null`),
    index('message_appointment_idx')
      .on(table.appointmentId)
      .where(sql`${table.appointmentId} is not null`),
    // WA-03: when a number last wrote to us, for WhatsApp's 24 hour window.
    index('message_inbound_phone_idx')
      .on(table.fromPhone, table.sentAt)
      .where(sql`${table.direction} = 'inbound'`),
    // WA-13: the failed messages the front desk follows up, newest first.
    index('message_failed_idx')
      .on(table.statusAt)
      .where(
        sql`${table.status} = 'failed' and ${table.direction} = 'outbound' and ${table.patientId} is not null`,
      ),
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
      sql`${table.direction} <> 'outbound' or (${table.toPhone} is not null and ${table.fromPhone} is null and ${table.templateKey} is not null and ${table.templateVersion} is not null and ${table.language} is not null and ${table.kind} in ('template', 'test', 'session') and ${table.status} <> 'received')`,
    ),
    // WA-03: only an inbound message is routed, and a route has its time.
    check(
      'message_route',
      sql`(${table.route} is null) = (${table.routedAt} is null) and (${table.route} is null or ${table.direction} = 'inbound')`,
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

/**
 * A failed message the front desk has followed up (WA-13): "Done" on Today's Not delivered panel,
 * by whom and when; the message then leaves the panel. Server only: written and read through
 * `internal.follow_up_undelivered` and `internal.undelivered_messages`, which check the person may
 * see the message's centre. Audited.
 */
export const messageFollowUp = pgTable('message_follow_up', {
  /** The message's own id, so its audit events name the message. */
  id: uuid('id')
    .primaryKey()
    .references(() => message.id, { onDelete: 'cascade' }),
  followedUpBy: uuid('followed_up_by')
    .notNull()
    .references(() => staffUser.id),
  followedUpAt: timestamp('followed_up_at', { withTimezone: true }).notNull().defaultNow(),
}).enableRLS();

export type MessageFollowUp = typeof messageFollowUp.$inferSelect;
