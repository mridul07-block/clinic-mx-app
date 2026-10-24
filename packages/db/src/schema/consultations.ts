import { consultationStatuses } from '@clinic-mx/schemas';
import { sql } from 'drizzle-orm';
import { check, integer, jsonb, pgEnum, pgTable, timestamp, uuid } from 'drizzle-orm/pg-core';
import { appointment } from './appointments';
import { episode } from './episodes';
import { staffUser } from './identity';
import { kbVersion } from './knowledge';

/**
 * A consultation (CLN-02, TAD section 4): what the consultant writes in its sections, on the
 * episode the health form opened, with the knowledge base version of the day (rule 4). Start
 * consultation opens it, one per appointment; only its own consultant edits it, saved by autosave
 * against `version`, and the rules migration keeps who, where and which version fixed. Signed
 * records never change (CLN-09 signs; changes are addenda).
 */
export const consultationStatus = pgEnum('consultation_status', consultationStatuses);

export const consultation = pgTable(
  'consultation',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    appointmentId: uuid('appointment_id')
      .notNull()
      .unique()
      .references(() => appointment.id),
    episodeId: uuid('episode_id')
      .notNull()
      .references(() => episode.id),
    /** The consultant who writes it: the appointment's physio. */
    physioId: uuid('physio_id')
      .notNull()
      .references(() => staffUser.id),
    kbVersionId: uuid('kb_version_id')
      .notNull()
      .references(() => kbVersion.id),
    /** The sections as `consultationSectionsSchema` reads them; a new one is `{}`. */
    sections: jsonb('sections').$type<Record<string, unknown>>().notNull().default({}),
    status: consultationStatus('status').notNull().default('draft'),
    signedBy: uuid('signed_by').references(() => staffUser.id),
    signedAt: timestamp('signed_at', { withTimezone: true }),
    version: integer('version').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check(
      'consultation_signed',
      sql`(${table.status} = 'signed') = (${table.signedAt} is not null) and (${table.signedAt} is null) = (${table.signedBy} is null)`,
    ),
  ],
).enableRLS();

export type Consultation = typeof consultation.$inferSelect;
