import { consentSigners, consentStages, signatureKinds } from '@clinic-mx/schemas';
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { appointment } from './appointments';
import { episode } from './episodes';
import { guardian, patient } from './patients';

/**
 * A consent decision (INT-06, TAD `consent_record`, Blueprint Module 3): one statement, its
 * version, accepted or declined, when, and the e-signature: drawn on the pad (a PNG in the
 * private `signatures` bucket at `signature_file`) or a typed full name. Records are only ever
 * added; a change of mind is a new record, and the latest for each statement counts. Part A comes
 * with a visit's health form; the episode is set on submit (INT-10). Part B (BIL-03) comes
 * through the episode's consent link, with its modality and, when filled in, the text shown.
 */
export const consentRecord = pgTable(
  'consent_record',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    patientId: uuid('patient_id')
      .notNull()
      .references(() => patient.id, { onDelete: 'cascade' }),
    appointmentId: uuid('appointment_id').references(() => appointment.id, {
      onDelete: 'cascade',
    }),
    episodeId: uuid('episode_id').references(() => episode.id),
    /** The link it was given through. */
    patientLinkId: uuid('patient_link_id'),
    stage: text('stage', { enum: consentStages }).notNull(),
    statementKey: text('statement_key').notNull(),
    statementVersion: integer('statement_version').notNull(),
    accepted: boolean('accepted').notNull(),
    signedAt: timestamp('signed_at', { withTimezone: true }).notNull().defaultNow(),
    signatureKind: text('signature_kind', { enum: signatureKinds }),
    /** In the `signatures` bucket: `<patient id>/<uuid>.png`. */
    signatureFile: text('signature_file'),
    typedName: text('typed_name'),
    signer: text('signer', { enum: consentSigners }).notNull(),
    /** The guardian on file who signed for a patient under the adult age (INT-07). */
    guardianId: uuid('guardian_id').references(() => guardian.id),
    /** A Part B modality card's modality (BIL-03). */
    modality: text('modality'),
    /**
     * The statement exactly as the patient read it, when it is filled in from their record (Part
     * B's plan statement names the diagnosis and the modalities, BIL-03); null otherwise.
     */
    shownText: text('shown_text'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('consent_record_appointment_idx').on(
      table.appointmentId,
      table.statementKey,
      table.createdAt,
    ),
    // Part B is read by episode (BIL-03).
    index('consent_record_episode_idx').on(table.episodeId, table.stage, table.statementKey),
    check('consent_record_stage', sql`${table.stage} in ('A', 'B', 'C')`),
    check('consent_record_signer', sql`${table.signer} in ('patient', 'guardian')`),
    // A guardian's record names the guardian on file; the patient's names none.
    check(
      'consent_record_guardian',
      sql`(${table.signer} = 'guardian') = (${table.guardianId} is not null)`,
    ),
    // Accepted is signed, drawn with its file or typed with the name; declined is not signed.
    check(
      'consent_record_signature',
      sql`case when ${table.accepted} then
        (${table.signatureKind} = 'drawn' and ${table.signatureFile} is not null and ${table.typedName} is null)
        or (${table.signatureKind} = 'typed' and ${table.typedName} is not null and ${table.signatureFile} is null)
      else ${table.signatureKind} is null and ${table.signatureFile} is null and ${table.typedName} is null end`,
    ),
  ],
).enableRLS();
