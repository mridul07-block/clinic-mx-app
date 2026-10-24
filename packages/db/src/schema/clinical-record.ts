import { interventionKinds, irritabilities, specialTestResults, stages } from '@clinic-mx/schemas';
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { consultation } from './consultations';
import { episode } from './episodes';
import { staffUser } from './identity';
import { kbCondition, kbVersion } from './knowledge';

/**
 * The signed clinical record (CLN-09, TAD section 4): what a consultation's signing writes from
 * its sections, and the addenda written after. Rows are written only in the signing transaction
 * and never change (rule 5); the rules migration holds that, and who reads them.
 */

export const measureLimb = pgEnum('measure_limb', ['involved', 'uninvolved']);
export const bodySide = pgEnum('body_side', ['left', 'right']);
export const specialTestResultValue = pgEnum('special_test_result_value', specialTestResults);
export const irritability = pgEnum('irritability', irritabilities);
export const clinicalStage = pgEnum('clinical_stage', stages);
export const interventionKind = pgEnum('intervention_kind', interventionKinds);
export const planOfCareStatus = pgEnum('plan_of_care_status', ['active']);

/** A measure taken (TAD `measure`): one side of a side by side measure, or a single value. */
export const measure = pgTable(
  'measure',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    episodeId: uuid('episode_id')
      .notNull()
      .references(() => episode.id),
    /** The consultation that took it; sessions take measures with SES and OUT tickets. */
    consultationId: uuid('consultation_id')
      .notNull()
      .references(() => consultation.id),
    kbVersionId: uuid('kb_version_id')
      .notNull()
      .references(() => kbVersion.id),
    /** The knowledge base measure, for example `knee.lsi.quadriceps`. */
    measureKey: text('measure_key').notNull(),
    limb: measureLimb('limb'),
    side: bodySide('side'),
    value: numeric('value', { mode: 'number' }).notNull(),
    unit: text('unit').notNull(),
    takenAt: timestamp('taken_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => staffUser.id),
  },
  (table) => [index('measure_episode_idx').on(table.episodeId, table.measureKey)],
).enableRLS();

/** A special test's result (TAD `special_test_result`). */
export const specialTestResult = pgTable(
  'special_test_result',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    episodeId: uuid('episode_id')
      .notNull()
      .references(() => episode.id),
    consultationId: uuid('consultation_id')
      .notNull()
      .references(() => consultation.id),
    kbVersionId: uuid('kb_version_id')
      .notNull()
      .references(() => kbVersion.id),
    testKey: text('test_key').notNull(),
    result: specialTestResultValue('result').notNull(),
    interpretation: text('interpretation').notNull(),
  },
  (table) => [
    unique('special_test_result_consultation_key').on(table.consultationId, table.testKey),
  ],
).enableRLS();

/** The four part working diagnosis (TAD `diagnosis`), one per consultation. */
export const diagnosis = pgTable(
  'diagnosis',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    consultationId: uuid('consultation_id')
      .notNull()
      .unique()
      .references(() => consultation.id),
    episodeId: uuid('episode_id')
      .notNull()
      .references(() => episode.id),
    kbVersionId: uuid('kb_version_id')
      .notNull()
      .references(() => kbVersion.id),
    conditionId: text('condition_id').notNull(),
    movementDx: text('movement_dx').notNull(),
    irritability: irritability('irritability').notNull(),
    stage: clinicalStage('stage').notNull(),
    /** The client's diagnosis category, coded from the condition once mapped (SET-12). */
    categoryCode: text('category_code'),
    provisional: boolean('provisional').notNull(),
  },
  (table) => [
    foreignKey({
      name: 'diagnosis_condition_fkey',
      columns: [table.kbVersionId, table.conditionId],
      foreignColumns: [kbCondition.kbVersionId, kbCondition.conditionId],
    }),
  ],
).enableRLS();

/** A plan of care (TAD `plan_of_care`); the consultation's is version 1. */
export const planOfCare = pgTable(
  'plan_of_care',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    episodeId: uuid('episode_id')
      .notNull()
      .references(() => episode.id),
    consultationId: uuid('consultation_id')
      .notNull()
      .references(() => consultation.id),
    version: integer('version').notNull(),
    goals: jsonb('goals').$type<{ text: string; patient: boolean }[]>().notNull(),
    interventions: interventionKind('interventions')
      .array()
      .notNull()
      .default(sql`'{}'::intervention_kind[]`),
    sessionsPerWeek: integer('sessions_per_week'),
    weeks: integer('weeks'),
    homeProgramme: jsonb('home_programme')
      .$type<{ exercise: string; dose: string; note: string }[]>()
      .notNull(),
    reviewDate: date('review_date').notNull(),
    questionnaires: text('questionnaires')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    treatingPhysioId: uuid('treating_physio_id')
      .notNull()
      .references(() => staffUser.id),
    /** Printed on the consultation summary when filled (ALT-06); '' for none. */
    investigationsAdvised: text('investigations_advised').notNull().default(''),
    referralAdvised: text('referral_advised').notNull().default(''),
    status: planOfCareStatus('status').notNull().default('active'),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => staffUser.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('plan_of_care_episode_version_key').on(table.episodeId, table.version),
    check('plan_of_care_version', sql`${table.version} >= 1`),
    check(
      'plan_of_care_frequency',
      sql`(${table.sessionsPerWeek} is null or ${table.sessionsPerWeek} between 1 and 7) and (${table.weeks} is null or ${table.weeks} between 1 and 52)`,
    ),
  ],
).enableRLS();

/** A modality in a plan (TAD `plan_modality`); its parameters arrive with SES-05. */
export const planModality = pgTable(
  'plan_modality',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    planOfCareId: uuid('plan_of_care_id')
      .notNull()
      .references(() => planOfCare.id),
    modalityKey: text('modality_key').notNull(),
    /** Why it is kept despite one of the patient's precautions; '' when none applied. */
    reason: text('reason').notNull(),
    parameters: jsonb('parameters')
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
  },
  (table) => [unique('plan_modality_plan_key').on(table.planOfCareId, table.modalityKey)],
).enableRLS();

/** A change to a signed consultation, written after (TAD `addendum`, rule 5). */
export const addendum = pgTable(
  'addendum',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    consultationId: uuid('consultation_id')
      .notNull()
      .references(() => consultation.id),
    episodeId: uuid('episode_id')
      .notNull()
      .references(() => episode.id),
    text: text('text').notNull(),
    authorId: uuid('author_id')
      .notNull()
      .references(() => staffUser.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('addendum_consultation_idx').on(table.consultationId, table.createdAt),
    check('addendum_text', sql`length(trim(${table.text})) between 1 and 5000`),
  ],
).enableRLS();
