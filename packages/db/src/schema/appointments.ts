import {
  appointmentChangeReasons,
  appointmentStatuses,
  bookingChannels,
  machines,
} from '@clinic-mx/schemas';
import { sql } from 'drizzle-orm';
import {
  check,
  date,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
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
export const appointmentChangeReason = pgEnum(
  'appointment_change_reason',
  appointmentChangeReasons,
);

/**
 * A series booked at once with "Book plan sessions" (SCH-11, PRD J4.8): the pattern the desk set
 * (a start date, ISO weekdays and one IST time, with a physio) and who booked it. Its appointments
 * carry its id, and the database queues one WhatsApp plan sessions list for it. Nobody changes or
 * deletes one.
 */
export const planBooking = pgTable(
  'plan_booking',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    episodeId: uuid('episode_id')
      .notNull()
      .references(() => episode.id),
    centreId: uuid('centre_id')
      .notNull()
      .references(() => centre.id),
    physioId: uuid('physio_id')
      .notNull()
      .references(() => staffUser.id),
    appointmentTypeId: uuid('appointment_type_id')
      .notNull()
      .references(() => appointmentType.id),
    fromDate: date('from_date').notNull(),
    /** ISO weekdays, Monday 1 to Sunday 7. */
    weekdays: integer('weekdays').array().notNull(),
    /** The IST time asked for, "HH:MM". */
    time: text('time').notNull(),
    bookedBy: uuid('booked_by')
      .notNull()
      .references(() => staffUser.id),
    bookedAt: timestamp('booked_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('plan_booking_episode_idx').on(table.episodeId, table.bookedAt),
    check('plan_booking_time', sql`${table.time} ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'`),
    check(
      'plan_booking_weekdays',
      sql`cardinality(${table.weekdays}) between 1 and 7 and ${table.weekdays} <@ array[1,2,3,4,5,6,7]`,
    ),
  ],
).enableRLS();

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
    /** Cancelled or rescheduled (SCH-08): who asked, and the staff member who did it, when. */
    changeReason: appointmentChangeReason('change_reason'),
    changedAt: timestamp('changed_at', { withTimezone: true }),
    changedBy: uuid('changed_by').references(() => staffUser.id),
    /** On the appointment a reschedule booked: the one it replaced (SCH-08). */
    rescheduledFromId: uuid('rescheduled_from_id')
      .unique()
      .references((): AnyPgColumn => appointment.id),
    /** Booked with "Book plan sessions" (SCH-11): the series it belongs to. */
    planBookingId: uuid('plan_booking_id').references(() => planBooking.id),
    arrivedAt: timestamp('arrived_at', { withTimezone: true }),
    /** Who checked the patient in, having checked who they are (INT-02); cleared by an undo. */
    checkedInBy: uuid('checked_in_by').references(() => staffUser.id),
    /** Marked a no show (INT-11): when, and the staff member who did it; cleared by an undo. */
    noShowAt: timestamp('no_show_at', { withTimezone: true }),
    noShowBy: uuid('no_show_by').references(() => staffUser.id),
    /** Started by its own physio from My patients today (CLN-01): In progress from then. */
    startedAt: timestamp('started_at', { withTimezone: true }),
    startedBy: uuid('started_by').references(() => staffUser.id),
    /** Completed: a consultation's visit when it is signed (CLN-09); sessions with SES-07. */
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // TAD section 6: slot queries use an index on (centre, physio, starts_at).
    index('appointment_centre_physio_start_idx').on(table.centreId, table.physioId, table.startsAt),
    index('appointment_patient_start_idx').on(table.patientId, table.startsAt),
    index('appointment_plan_booking_idx').on(table.planBookingId),
    check('appointment_span', sql`${table.endsAt} > ${table.startsAt}`),
    // A booking made by staff (Front desk or Walk in) records who made it (PRD J1.5).
    check(
      'appointment_staff_booked_by',
      sql`${table.channel} = 'whatsapp' or ${table.bookedBy} is not null`,
    ),
    check('appointment_machine', machineCheck(table.machine)),
    check(
      'appointment_change',
      sql`(${table.status} in ('cancelled', 'rescheduled')) = (${table.changeReason} is not null and ${table.changedAt} is not null and ${table.changedBy} is not null) and (${table.changeReason} is null) = (${table.changedAt} is null) and (${table.changeReason} is null) = (${table.changedBy} is null)`,
    ),
    check(
      'appointment_arrived',
      sql`(${table.status} <> 'checked_in' or ${table.arrivedAt} is not null) and (${table.arrivedAt} is null) = (${table.checkedInBy} is null)`,
    ),
    check(
      'appointment_no_show',
      sql`(${table.status} = 'no_show') = (${table.noShowAt} is not null) and (${table.noShowAt} is null) = (${table.noShowBy} is null)`,
    ),
    check(
      'appointment_started',
      sql`(${table.status} <> 'in_progress' or ${table.startedAt} is not null) and (${table.startedAt} is null) = (${table.startedBy} is null)`,
    ),
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
export type PlanBooking = typeof planBooking.$inferSelect;

/**
 * A patient's reschedules (asked by the patient) and verified no shows (SCH-09, PRD J1.8, TAD
 * `booking_counter`): at `booking.self_booking_block_*` the patient can no longer book themselves.
 * Only the database's trigger on appointment counts; a Centre Manager or the Super Admin lifts
 * the block, which sets both to zero and records who and when.
 */
export const bookingCounter = pgTable(
  'booking_counter',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    patientId: uuid('patient_id')
      .notNull()
      .unique()
      .references(() => patient.id, { onDelete: 'cascade' }),
    reschedules: integer('reschedules').notNull().default(0),
    noShows: integer('no_shows').notNull().default(0),
    liftedAt: timestamp('lifted_at', { withTimezone: true }),
    liftedBy: uuid('lifted_by').references(() => staffUser.id),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check('booking_counter_counts', sql`${table.reschedules} >= 0 and ${table.noShows} >= 0`),
    check('booking_counter_lifted', sql`(${table.liftedAt} is null) = (${table.liftedBy} is null)`),
  ],
).enableRLS();
