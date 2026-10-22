import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { staffUser } from './identity';

/**
 * Appointment types and their lengths (SET-03, PRD M2 and section 7). The Super Admin keeps the
 * types; a physio may have their own length for any type, and without one the type's length
 * applies. Lengths fit the calendar grid (`scheduling.slot_minutes`), checked by the service.
 * Nothing is deleted except a physio's own length, cleared back to the type's.
 */

const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
};

export const appointmentType = pgTable(
  'appointment_type',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Made from the name when the type is added and never changed; code refers to it. */
    key: text('key').notNull().unique(),
    name: text('name').notNull(),
    minutes: integer('minutes').notNull(),
    active: boolean('active').notNull().default(true),
    ...timestamps,
  },
  (table) => [
    check('appointment_type_key', sql`${table.key} ~ '^[a-z][a-z0-9_]*$'`),
    check('appointment_type_name', sql`length(trim(${table.name})) between 1 and 60`),
    check('appointment_type_minutes', sql`${table.minutes} > 0`),
    uniqueIndex('appointment_type_name_lower_key').on(sql`lower(${table.name})`),
  ],
).enableRLS();

/** A physio's own length for a type; without a row, the type's length applies. */
export const physioAppointmentLength = pgTable(
  'physio_appointment_length',
  {
    staffUserId: uuid('staff_user_id')
      .notNull()
      .references(() => staffUser.id),
    appointmentTypeId: uuid('appointment_type_id')
      .notNull()
      .references(() => appointmentType.id),
    minutes: integer('minutes').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.staffUserId, table.appointmentTypeId] }),
    index('physio_appointment_length_type_idx').on(table.appointmentTypeId),
    check('physio_appointment_length_minutes', sql`${table.minutes} > 0`),
  ],
).enableRLS();

export type AppointmentType = typeof appointmentType.$inferSelect;
