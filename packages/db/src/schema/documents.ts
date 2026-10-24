import { documentKinds } from '@clinic-mx/schemas';
import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { episode } from './episodes';
import { centre } from './identity';
import { patient } from './patients';

export const documentKind = pgEnum('document_kind', documentKinds);

/**
 * A generated PDF (ALT-05, TAD section 9): one row per version of a document, the file in the
 * private `documents` bucket at `file_path`. Regenerating after an addendum adds the next version
 * and never overwrites one. Only the server writes rows, as the system; nobody updates them.
 */
export const document = pgTable(
  'document',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    kind: documentKind('kind').notNull(),
    patientId: uuid('patient_id')
      .notNull()
      .references(() => patient.id, { onDelete: 'cascade' }),
    /** The episode it belongs to (TAD section 4); none for a bill without one. */
    episodeId: uuid('episode_id').references(() => episode.id),
    /** Whose letterhead it is printed on, and where an invoice is read. */
    centreId: uuid('centre_id')
      .notNull()
      .references(() => centre.id),
    /** The record it was built from (a signed consultation, a paid bill); its versions share it. */
    sourceId: uuid('source_id').notNull(),
    version: integer('version').notNull(),
    /** Within the `documents` bucket: `<patient id>/<document id>.pdf`. */
    filePath: text('file_path').notNull().unique(),
    sizeBytes: integer('size_bytes').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('document_version_key').on(table.kind, table.sourceId, table.version),
    index('document_patient_idx').on(table.patientId, table.createdAt),
    check('document_version_positive', sql`${table.version} >= 1`),
    check('document_size', sql`${table.sizeBytes} > 0`),
  ],
).enableRLS();
