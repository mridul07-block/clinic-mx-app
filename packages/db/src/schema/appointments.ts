import { appointmentStatuses, bookingChannels, machines } from '@clinic-mx/schemas';
import { sql } from 'drizzle-orm';
import { check, index, integer, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { appointmentType } from './appointment-types';
import { episode } from './episodes';
import { centre, staffUser } from './identity';
import { patient } from './patients';

/**
 * Appointments and slot holds (SCH-04, TAD sections 4 and 6). A physio is never booked twice at
 * once, at any centre, and a centre's machine unit never twice: exclusion constraints in the
 * rules migration refuse it while the appointment holds its slot (every status but Cancelled and
 * Rescheduled). A hold keeps a picked slot for one holder for `booking.slot_hold_minutes`; holds
 * have the same constraints, and the booking transaction rechecks holds and appointments together
 * under a lock (`packages/db/src/slots.ts`). Times are UTC instants (rule 15).
 */

const machineCheck = (column: unknown) =>
  sql`${column} is null or ${column} in (${sql.raw(machines.map((m) => `'${m}'`).join(', '))})`;

export const appointmentStatus = pgEnum('appointment_status', appointmentStatuses);
export const bookingChannel = pgEnum('booking_channel', bookingChannels);

export const appointment = pgTable(
  'appointment',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** The appointment ID, for example MVK-00042: the centre's prefix and its next number. */
    number: text('number').notNull().unique(),
    patientId: uuid('patient_id')
      .notNull()
      .references(() => patient.id),
    centreId: uuid('centre_id')
      .notNull()
      .references(() => centre.id),
    physioId: uuid('physio_id')
      .notNull()
      .references(() => staffUser.id),
    appointmentTypeId: uuid('appointment_type_id')
      .notNull()
      .references(() => appointmentType.id),
    episodeId: uuid('episode_id').references(() => episode.id),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
    status: appointmentStatus('status').notNull().default('booked'),
    channel: bookingChannel('channel').notNull(),
    /** The staff member who booked it; none for a patient's own WhatsApp booking. */
    bookedBy: uuid('booked_by').references(() => staffUser.id),
    machine: text('machine', { enum: machines }),
    /** Which of the centre's units of the machine, 1 upwards. */
    machineUnit: integer('machine_unit'),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
    arrivedAt: timestamp('arrived_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // TAD section 6: slot queries use an index on (centre, physio, starts_at).
    index('appointment_centre_physio_start_idx').on(table.centreId, table.physioId, table.startsAt),
    index('appointment_patient_start_idx').on(table.patientId, table.startsAt),
    check('appointment_span', sql`${table.endsAt} > ${table.startsAt}`),
    check(
      'appointment_front_desk_booked_by',
      sql`${table.channel} <> 'front_desk' or ${table.bookedBy} is not null`,
    ),
    check('appointment_machine', machineCheck(table.machine)),
    check(
      'appointment_machine_unit',
      sql`(${table.machine} is null) = (${table.machineUnit} is null) and (${table.machineUnit} is null or ${table.machineUnit} >= 1)`,
    ),
  ],
).enableRLS();

export const slotHold = pgTable(
  'slot_hold',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Who holds it: `staff:<id>` at the front desk, a Flow session on WhatsApp (WA-04). */
    holder: text('holder').notNull().unique(),
    centreId: uuid('centre_id')
      .notNull()
      .references(() => centre.id),
    physioId: uuid('physio_id')
      .notNull()
      .references(() => staffUser.id),
    appointmentTypeId: uuid('appointment_type_id')
      .notNull()
      .references(() => appointmentType.id),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
    machine: text('machine', { enum: machines }),
    machineUnit: integer('machine_unit'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('slot_hold_physio_start_idx').on(table.physioId, table.startsAt),
    index('slot_hold_expires_idx').on(table.expiresAt),
    check('slot_hold_span', sql`${table.endsAt} > ${table.startsAt}`),
    check('slot_hold_machine', machineCheck(table.machine)),
    check(
      'slot_hold_machine_unit',
      sql`(${table.machine} is null) = (${table.machineUnit} is null) and (${table.machineUnit} is null or ${table.machineUnit} >= 1)`,
    ),
  ],
).enableRLS();

export type Appointment = typeof appointment.$inferSelect;
export type SlotHold = typeof slotHold.$inferSelect;
