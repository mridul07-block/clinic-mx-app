import { check, index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { appointment } from './appointments';

/**
 * A WhatsApp Flow a person has open (WA-04; TAD section 6). Its id is the Flow token Meta sends
 * back with every screen, so the data endpoint knows whose number it is serving without trusting
 * the form; `state` keeps what they picked so far. Server only: no policy, no rights for signed in
 * staff, not audited (the patient and appointment it makes are). Deleted hourly once older than
 * `whatsapp.event_retention_days`.
 */
export const whatsappFlowSession = pgTable(
  'whatsapp_flow_session',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** E.164: who the Flow was sent to. */
    phone: text('phone').notNull(),
    /** `booking` (WA-04); `reschedule` comes with WA-05. */
    kind: text('kind').notNull(),
    state: jsonb('state').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    /** The appointment it booked: a second confirm returns this one. */
    appointmentId: uuid('appointment_id').references(() => appointment.id),
  },
  (table) => [
    index('whatsapp_flow_session_created_at_idx').on(table.createdAt),
    check('whatsapp_flow_session_phone', sql`${table.phone} ~ '^\\+[1-9][0-9]{7,14}$'`),
    check('whatsapp_flow_session_kind', sql`${table.kind} in ('booking')`),
    check('whatsapp_flow_session_expiry', sql`${table.expiresAt} > ${table.createdAt}`),
  ],
).enableRLS();

export type WhatsappFlowSession = typeof whatsappFlowSession.$inferSelect;
