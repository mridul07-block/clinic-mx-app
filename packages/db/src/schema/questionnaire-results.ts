import type { QuestionnaireRawAnswers } from '@clinic-mx/schemas';
import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { episode } from './episodes';
import { centre } from './identity';
import { kbVersion } from './knowledge';
import { patientLink } from './patient-links';
import { patient } from './patients';

/**
 * A questionnaire the patient filled (OUT-02; TAD `questionnaire_result`: "instrument_key,
 * version, raw_answers, score, interpretation"; Blueprint Module 8: "the name and version,
 * administration date, raw item responses, calculated score"). Written by the patient through a
 * questionnaire link, once per instrument per link, and never changed. It keeps the knowledge
 * base version and the instrument's own version it was filled on, the raw answers, and the score
 * our server worked out by the instrument's rule (`scoreQuestionnaire`): none when too many items
 * were left unanswered, which it says.
 */
export const questionnaireResult = pgTable(
  'questionnaire_result',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    patientLinkId: uuid('patient_link_id')
      .notNull()
      .references(() => patientLink.id),
    patientId: uuid('patient_id')
      .notNull()
      .references(() => patient.id),
    episodeId: uuid('episode_id')
      .notNull()
      .references(() => episode.id),
    centreId: uuid('centre_id')
      .notNull()
      .references(() => centre.id),
    kbVersionId: uuid('kb_version_id')
      .notNull()
      .references(() => kbVersion.id),
    instrumentKey: text('instrument_key').notNull(),
    instrumentVersion: text('instrument_version').notNull(),
    /** Each item's answer as given: the value chosen (null when skipped), an activity's name. */
    rawAnswers: jsonb('raw_answers').$type<QuestionnaireRawAnswers>().notNull(),
    /** One decimal place; null when not scored. */
    score: numeric('score', { precision: 7, scale: 1, mode: 'number' }),
    answered: integer('answered').notNull(),
    missing: integer('missing').notNull(),
    submittedAt: timestamp('submitted_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('questionnaire_result_once_per_link').on(table.patientLinkId, table.instrumentKey),
    index('questionnaire_result_episode_idx').on(
      table.episodeId,
      table.instrumentKey,
      table.submittedAt,
    ),
    check('questionnaire_result_counts', sql`${table.answered} >= 0 and ${table.missing} >= 0`),
    check('questionnaire_result_answers', sql`jsonb_typeof(${table.rawAnswers}) = 'object'`),
  ],
).enableRLS();
