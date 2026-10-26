import { sessionStatuses } from '@clinic-mx/schemas';
import { sql } from 'drizzle-orm';
import {
  check,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  smallint,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { appointment } from './appointments';
import { planOfCare } from './clinical-record';
import { episode } from './episodes';
import { centre, staffUser } from './identity';
import { kbVersion } from './knowledge';
import { patientPackage } from './packages';
import { patient } from './patients';

/**
 * A treatment session (SES-03, TAD `session`): opened when its physio starts a Session or Zero
 * Gravity Treadmill visit, with its number in the episode, the knowledge base version (rule 4)
 * and the plan version it follows. Its physio writes the note while it is a draft, saved by
 * autosave against `version`; Close session signs it, which completes the visit, uses a package
 * session and stores the three pain readings. Signed sessions never change (rule 5).
 */
export const sessionStatus = pgEnum('session_status', sessionStatuses);

export const treatmentSession = pgTable(
  'session',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    appointmentId: uuid('appointment_id')
      .notNull()
      .unique()
      .references(() => appointment.id),
    episodeId: uuid('episode_id')
      .notNull()
      .references(() => episode.id),
    patientId: uuid('patient_id')
      .notNull()
      .references(() => patient.id),
    centreId: uuid('centre_id')
      .notNull()
      .references(() => centre.id),
    /** The physio who writes and signs it: the appointment's physio. */
    physioId: uuid('physio_id')
      .notNull()
      .references(() => staffUser.id),
    /** Session n of the episode, as it was when the session started (SES-01). */
    number: integer('number').notNull(),
    kbVersionId: uuid('kb_version_id')
      .notNull()
      .references(() => kbVersion.id),
    /** The plan it follows: the episode's newest when it started. */
    planOfCareId: uuid('plan_of_care_id').references(() => planOfCare.id),
    /** The note as `sessionNoteSchema` reads it. */
    note: jsonb('note').$type<Record<string, unknown>>().notNull().default({}),
    /** NPRS 0 to 10 at rest, during activity and after treatment, set when signed. */
    painRest: smallint('pain_rest'),
    painActivity: smallint('pain_activity'),
    painAfter: smallint('pain_after'),
    status: sessionStatus('status').notNull().default('draft'),
    signedBy: uuid('signed_by').references(() => staffUser.id),
    signedAt: timestamp('signed_at', { withTimezone: true }),
    /** The package whose session closing used, if one was active. */
    packageId: uuid('package_id').references(() => patientPackage.id),
    version: integer('version').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check(
      'session_signed',
      sql`(${table.status} = 'signed') = (${table.signedAt} is not null) and (${table.signedAt} is null) = (${table.signedBy} is null)`,
    ),
    check(
      'session_signed_pain',
      sql`${table.status} = 'draft' or (${table.painRest} is not null and ${table.painActivity} is not null and ${table.painAfter} is not null)`,
    ),
    check(
      'session_pain_range',
      sql`${table.painRest} between 0 and 10 and ${table.painActivity} between 0 and 10 and ${table.painAfter} between 0 and 10`,
    ),
    check('session_number', sql`${table.number} >= 1`),
  ],
).enableRLS();

export type TreatmentSession = typeof treatmentSession.$inferSelect;
