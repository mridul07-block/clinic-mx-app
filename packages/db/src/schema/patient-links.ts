import { patientLinkPurposes } from '@clinic-mx/schemas';
import { sql } from 'drizzle-orm';
import { check, index, pgEnum, pgTable, timestamp, uuid } from 'drizzle-orm/pg-core';
import { patient } from './patients';

/**
 * Patient links (IAM-09, TAD sections 3 and 5). One row per link: who it is for, its purpose,
 * the appointment or episode it is tied to, and when it ends. The token itself is never stored:
 * it is the row id signed with PATIENT_LINK_SECRET, so a copy of the table cannot open a link.
 * The appointment and episode foreign keys arrive with the tables they point to; the patient one
 * came with SCH-01, unchecked for links made before it.
 */
export const patientLinkPurpose = pgEnum('patient_link_purpose', patientLinkPurposes);

export const patientLink = pgTable(
  'patient_link',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    patientId: uuid('patient_id')
      .notNull()
      .references(() => patient.id),
    purpose: patientLinkPurpose('purpose').notNull(),
    appointmentId: uuid('appointment_id'),
    episodeId: uuid('episode_id'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    /** Stopped before its expiry, for example by a newer My plan link. */
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    /** A single use link that was submitted. */
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('patient_link_patient_idx').on(table.patientId, table.purpose),
    check(
      'patient_link_one_subject',
      sql`num_nonnulls(${table.appointmentId}, ${table.episodeId}) = 1`,
    ),
    check(
      'patient_link_subject_fits',
      sql`(${table.purpose} <> 'health_form' or ${table.appointmentId} is not null)
        and (${table.purpose} not in ('questionnaire', 'my_plan') or ${table.episodeId} is not null)`,
    ),
    check('patient_link_window', sql`${table.expiresAt} > ${table.createdAt}`),
  ],
).enableRLS();

export type PatientLink = typeof patientLink.$inferSelect;
