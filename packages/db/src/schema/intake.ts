import type { HealthFormAnswer } from '@clinic-mx/schemas';
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { appointment } from './appointments';
import { episode } from './episodes';
import { staffUser } from './identity';
import { patient } from './patients';

/**
 * A patient's health form for one visit (INT-04, TAD `intake_response`): the form version it was
 * given, the answers so far and the screens sent, saved after every screen so a patient who
 * leaves carries on where they stopped. Submitting (INT-05, INT-10) sets `submitted_at`; the
 * episode comes with INT-10, and who helped in assisted mode with INT-09. A returning patient
 * (INT-08) answers "Has anything changed?" about the details carried over from their earlier form.
 */
export const intakeResponse = pgTable(
  'intake_response',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** One health form per visit. */
    appointmentId: uuid('appointment_id')
      .notNull()
      .unique()
      .references(() => appointment.id, { onDelete: 'cascade' }),
    patientId: uuid('patient_id')
      .notNull()
      .references(() => patient.id, { onDelete: 'cascade' }),
    /** The link it was filled through. */
    patientLinkId: uuid('patient_link_id').notNull(),
    /** The health form version the answers belong to (`healthForms`); never changes. */
    formVersion: text('form_version').notNull(),
    answers: jsonb('answers')
      .$type<Record<string, HealthFormAnswer>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    /** The screens sent so far, by key. */
    doneScreens: text('done_screens')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
    /** The episode its submit opened (INT-10). */
    episodeId: uuid('episode_id').references(() => episode.id),
    assistedBy: uuid('assisted_by').references(() => staffUser.id),
    /** The earlier, submitted form whose details were carried over (INT-08). */
    carriedFromId: uuid('carried_from_id').references((): AnyPgColumn => intakeResponse.id),
    /** The patient's answer to "Has anything changed?": null until answered, or not returning. */
    detailsChanged: boolean('details_changed'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('intake_response_patient_submitted').on(table.patientId, table.submittedAt),
    check(
      'intake_response_details_review',
      sql`(${table.carriedFromId} is null) = (${table.detailsChanged} is null)`,
    ),
  ],
).enableRLS();
