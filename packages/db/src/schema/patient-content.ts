import { patientContentSources, patientContentStatuses } from '@clinic-mx/schemas';
import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { staffUser } from './identity';
import { kbVersion } from './knowledge';

export const patientContentStatus = pgEnum('patient_content_status', patientContentStatuses);
export const patientContentSource = pgEnum('patient_content_source', patientContentSources);

/**
 * Patient content for a condition (AI-07; TAD `kb_patient_content`: "condition ID, explanation,
 * roadmap, home advice, warning signs, approved_by"; PRD J3.8: "clinician approved content for the
 * diagnosis"). Keyed by the condition's stable ID so it outlives knowledge base versions; the
 * version it was written against is kept. A draft (written by a consultant who treats patients, or
 * generated once by AI when the gateway has its key) becomes what patients see only when such a
 * consultant approves it; an approved text never changes: a new draft, approved, supersedes it.
 */
export const kbPatientContent = pgTable(
  'kb_patient_content',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    conditionId: text('condition_id').notNull(),
    kbVersionId: uuid('kb_version_id')
      .notNull()
      .references(() => kbVersion.id),
    /** The condition in plain words: what it is and why it happened. */
    explanation: text('explanation').notNull(),
    /** The rehabilitation roadmap and the expected timeline. */
    roadmap: text('roadmap').notNull(),
    /** Home advice: what to do and what not to do. */
    homeAdvice: text('home_advice').notNull(),
    /** When to contact the clinic or seek care. */
    warningSigns: text('warning_signs').notNull(),
    source: patientContentSource('source').notNull(),
    status: patientContentStatus('status').notNull().default('draft'),
    /** Who wrote or last edited the draft; none for an AI draft not yet edited. */
    writtenBy: uuid('written_by').references(() => staffUser.id),
    approvedBy: uuid('approved_by').references(() => staffUser.id),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    /** Counts saves of a draft, so a decision or a save is on the text that was read. */
    revision: integer('revision').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('kb_patient_content_one_draft')
      .on(table.conditionId)
      .where(sql`${table.status} = 'draft'`),
    uniqueIndex('kb_patient_content_one_approved')
      .on(table.conditionId)
      .where(sql`${table.status} = 'approved'`),
    index('kb_patient_content_condition_idx').on(table.conditionId, table.createdAt),
    check('kb_patient_content_condition', sql`${table.conditionId} ~ '^[A-Z]{2,4}-[0-9]{3}$'`),
    check(
      'kb_patient_content_approval',
      sql`(${table.status} = 'draft') = (${table.approvedBy} is null and ${table.approvedAt} is null)`,
    ),
    check(
      'kb_patient_content_lengths',
      sql`length(trim(${table.explanation})) between 1 and 4000
        and length(trim(${table.roadmap})) between 1 and 4000
        and length(trim(${table.homeAdvice})) between 1 and 4000
        and length(trim(${table.warningSigns})) between 1 and 4000`,
    ),
  ],
).enableRLS();
