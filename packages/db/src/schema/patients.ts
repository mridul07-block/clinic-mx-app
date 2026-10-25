import { guardianRelationships, patientSexes } from '@clinic-mx/schemas';
import { sql } from 'drizzle-orm';
import {
  check,
  date,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { centre } from './identity';

/**
 * Patients (SCH-01, TAD section 4). Keyed by person: the phone number is not unique, so a family
 * shares one mobile. Every centre sees every patient (PRD J7.6). The OP number is set by a
 * database trigger from the registering centre's sequence (`HSR-00042`); neither it nor the
 * registering centre ever changes.
 */
export const patientSex = pgEnum('patient_sex', patientSexes);

export const patient = pgTable(
  'patient',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    /** E.164, +91 and 10 digits; shared by everyone on one mobile. */
    phone: text('phone').notNull(),
    email: text('email'),
    dateOfBirth: date('date_of_birth'),
    sex: patientSex('sex'),
    occupation: text('occupation'),
    /** Set by the `patient_op_number` trigger; whatever a caller gives is replaced. */
    opNumber: text('op_number').notNull().unique(),
    registeredCentreId: uuid('registered_centre_id')
      .notNull()
      .references(() => centre.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('patient_phone_idx').on(table.phone),
    index('patient_name_idx').on(sql`lower(${table.name})`),
    check('patient_phone_e164', sql`${table.phone} ~ '^\\+91[1-9][0-9]{9}$'`),
    check('patient_name_present', sql`btrim(${table.name}) <> ''`),
  ],
).enableRLS();

export type Patient = typeof patient.$inferSelect;
export type NewPatientRow = typeof patient.$inferInsert;

/**
 * The human facing numbers a centre issues (TAD section 3): OP numbers now; appointment IDs and
 * bill numbers (BIL-05), invoice numbers (BIL-09). Server only: read and advanced by `internal.next_centre_number`,
 * under a row lock, so numbers have no gaps and never repeat.
 */
export const centreSequenceKinds = ['op_number', 'appointment', 'bill', 'invoice'] as const;
export const centreSequenceKind = pgEnum('centre_sequence_kind', centreSequenceKinds);

export const centreSequence = pgTable(
  'centre_sequence',
  {
    centreId: uuid('centre_id')
      .notNull()
      .references(() => centre.id),
    kind: centreSequenceKind('kind').notNull(),
    lastValue: integer('last_value').notNull().default(0),
  },
  (table) => [
    primaryKey({ columns: [table.centreId, table.kind] }),
    check('centre_sequence_positive', sql`${table.lastValue} >= 0`),
  ],
).enableRLS();

/**
 * Guardians (SCH-02, TAD section 4): several per patient, for a patient under the adult age
 * (setting `patients.adult_age_years`). Removed, never deleted: consent records (INT-07) point to
 * the guardian who signed.
 */
export const guardianRelationship = pgEnum('guardian_relationship', guardianRelationships);

export const guardian = pgTable(
  'guardian',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    patientId: uuid('patient_id')
      .notNull()
      .references(() => patient.id),
    name: text('name').notNull(),
    relationship: guardianRelationship('relationship').notNull(),
    /** E.164, +91 and 10 digits; often the patient's own mobile. */
    phone: text('phone').notNull(),
    removedAt: timestamp('removed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('guardian_patient_idx').on(table.patientId),
    check('guardian_phone_e164', sql`${table.phone} ~ '^\\+91[1-9][0-9]{9}$'`),
    check('guardian_name_present', sql`btrim(${table.name}) <> ''`),
  ],
).enableRLS();

export type Guardian = typeof guardian.$inferSelect;
