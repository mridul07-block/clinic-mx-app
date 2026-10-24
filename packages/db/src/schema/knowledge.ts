import {
  knowledgeRegionKeys,
  knowledgeVersionStatuses,
  measureKinds,
  type MeasureRule,
  onsets,
  redFlagTiers,
  redFlagTriages,
  screeningRegions,
  sexPredominances,
  type RedFlagRule,
} from '@clinic-mx/schemas';
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { staffUser } from './identity';

/**
 * The clinical knowledge base (SET-05, TAD section 4 "Knowledge base tables", rule 4). A version
 * is a whole copy of the knowledge base, imported from the nine workbooks and never edited in
 * place; clinical records store the version they used. A condition is one stable ID; each
 * workbook row describing it is a listing, so a condition two regions describe (Cervical
 * Radiculopathy in Shoulder and Cervical) keeps both texts under one ID. Read only in the app:
 * the import writes as the owner, and approval arrives with SET-06.
 */

export const kbVersionStatus = pgEnum('kb_version_status', knowledgeVersionStatuses);
export const kbRegion = pgEnum('kb_region', knowledgeRegionKeys);
export const kbRedFlagTier = pgEnum('kb_red_flag_tier', redFlagTiers);
export const kbOnset = pgEnum('kb_onset', onsets);
export const kbSexPredominance = pgEnum('kb_sex_predominance', sexPredominances);

/** What a version was imported from: each workbook's file name and SHA-256. */
export interface KnowledgeSource {
  files: { name: string; sha256: string }[];
  /** The workbook sheets read (CLN-05 added Special Tests and the Progress Tracker). */
  sheets?: string[];
}

export const kbVersion = pgTable(
  'kb_version',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    number: integer('number').notNull().unique(),
    status: kbVersionStatus('status').notNull().default('draft'),
    notes: text('notes'),
    source: jsonb('source').$type<KnowledgeSource>().notNull(),
    /** The import report (counts, merges, readings to check), for SET-06's viewer. */
    report: jsonb('report').$type<Record<string, unknown>>().notNull(),
    /** The audit actor that made it, for example `system:kb-import`. */
    createdBy: text('created_by').notNull(),
    approvedBy: uuid('approved_by').references(() => staffUser.id),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check('kb_version_number', sql`${table.number} >= 1`),
    check(
      'kb_version_approved',
      sql`(${table.status} = 'approved') = (${table.approvedBy} is not null and ${table.approvedAt} is not null)`,
    ),
  ],
).enableRLS();

/**
 * The client's diagnosis categories (CLN-06, PRD J3.6 "the client's diagnosis category is coded
 * automatically"): its "Physiotherapeutic diagnosis" list word for word, from the committed
 * `diagnosis-categories.json`, each with a stable code.
 */
export const kbDiagnosisCategory = pgTable(
  'kb_diagnosis_category',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    kbVersionId: uuid('kb_version_id')
      .notNull()
      .references(() => kbVersion.id),
    /** Stable across versions, for example `knee_pfps`. */
    code: text('code').notNull(),
    name: text('name').notNull(),
    /** The list's order. */
    sort: integer('sort').notNull(),
  },
  (table) => [
    unique('kb_diagnosis_category_version_code_key').on(table.kbVersionId, table.code),
    check('kb_diagnosis_category_code', sql`${table.code} ~ '^[a-z][a-z0-9_]*$'`),
  ],
).enableRLS();

export const kbCondition = pgTable(
  'kb_condition',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    kbVersionId: uuid('kb_version_id')
      .notNull()
      .references(() => kbVersion.id),
    /** Stable across versions (`SHO-001`); diagnoses and AI suggestions refer to it. */
    conditionId: text('condition_id').notNull(),
    name: text('name').notNull(),
    synonyms: text('synonyms')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    /** The workbook whose prefix the ID carries. */
    homeRegion: kbRegion('home_region').notNull(),
    /** The client's category for it (CLN-06), once mapped in the categories file (SET-12). */
    categoryCode: text('category_code'),
  },
  (table) => [
    unique('kb_condition_version_condition_key').on(table.kbVersionId, table.conditionId),
    foreignKey({
      name: 'kb_condition_category_fkey',
      columns: [table.kbVersionId, table.categoryCode],
      foreignColumns: [kbDiagnosisCategory.kbVersionId, kbDiagnosisCategory.code],
    }),
    check('kb_condition_id', sql`${table.conditionId} ~ '^[A-Z]{3}-[0-9]{3}$'`),
    check('kb_condition_name', sql`length(trim(${table.name})) >= 1`),
  ],
).enableRLS();

export const kbConditionListing = pgTable(
  'kb_condition_listing',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    kbVersionId: uuid('kb_version_id')
      .notNull()
      .references(() => kbVersion.id),
    conditionId: text('condition_id').notNull(),
    /** The workbook, and the row in its Master Matrix sheet (as Excel numbers it). */
    region: kbRegion('region').notNull(),
    rowNumber: integer('row_number').notNull(),
    /** The name as this workbook writes it. */
    name: text('name').notNull(),
    /** The Region column (Bone Stress: Tissue), spelled one way. */
    subregion: text('subregion').notNull(),
    ageMin: integer('age_min'),
    ageMax: integer('age_max'),
    ageText: text('age_text'),
    onsets: kbOnset('onsets')
      .array()
      .notNull()
      .default(sql`'{}'::kb_onset[]`),
    onsetText: text('onset_text'),
    sex: kbSexPredominance('sex'),
    sexText: text('sex_text'),
    activityTags: text('activity_tags')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    activityText: text('activity_text'),
    redFlagTier: kbRedFlagTier('red_flag_tier').notNull(),
    redFlagText: text('red_flag_text'),
    /** Bone Stress only: its Risk Class column. */
    riskClass: text('risk_class'),
    symptoms: text('symptoms'),
    discriminatingQuestion: text('discriminating_question'),
    testsImaging: text('tests_imaging'),
    biomechanicalCause: text('biomechanical_cause'),
    /** Every other column, word for word: canonical key to `{ label, text }`. */
    details: jsonb('details').$type<Record<string, { label: string; text: string }>>().notNull(),
  },
  (table) => [
    unique('kb_condition_listing_row_key').on(table.kbVersionId, table.region, table.rowNumber),
    foreignKey({
      name: 'kb_condition_listing_condition_fkey',
      columns: [table.kbVersionId, table.conditionId],
      foreignColumns: [kbCondition.kbVersionId, kbCondition.conditionId],
    }),
    index('kb_condition_listing_condition_idx').on(table.kbVersionId, table.conditionId),
    check(
      'kb_condition_listing_age',
      sql`${table.ageMin} is null or ${table.ageMax} is null or ${table.ageMin} <= ${table.ageMax}`,
    ),
  ],
).enableRLS();

/** The framework's triage categories (SET-10). */
export const redFlagTriage = pgEnum('red_flag_triage', redFlagTriages);
export const screeningRegion = pgEnum('screening_region', screeningRegions);
export const kbRedFlagRowKind = pgEnum('kb_red_flag_row_kind', ['presentation', 'screening_note']);

/**
 * A red flag rule in a version (SET-10, TAD `kb_red_flag_rule`): run over the health form's
 * screening answers when it is submitted. Imported from the committed rules file.
 */
export const kbRedFlagRule = pgTable(
  'kb_red_flag_rule',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    kbVersionId: uuid('kb_version_id')
      .notNull()
      .references(() => kbVersion.id),
    /** Stable across versions, for example `back.cauda_equina`. */
    ruleKey: text('rule_key').notNull(),
    name: text('name').notNull(),
    /** Where it applies; empty for everywhere. */
    regions: screeningRegion('regions')
      .array()
      .notNull()
      .default(sql`'{}'::screening_region[]`),
    trigger: jsonb('trigger').$type<RedFlagRule['trigger']>().notNull(),
    triage: redFlagTriage('triage').notNull(),
    action: text('action').notNull(),
    source: text('source').notNull(),
    /** False until the client's clinical lead signs the rule off. */
    signedOff: boolean('signed_off').notNull(),
  },
  (table) => [
    unique('kb_red_flag_rule_version_key').on(table.kbVersionId, table.ruleKey),
    check('kb_red_flag_rule_key', sql`${table.ruleKey} ~ '^[a-z][a-z0-9_.]*$'`),
  ],
).enableRLS();

/**
 * A row of a workbook's Red Flags sheet (SET-10): a presentation with its features, action and why
 * it cannot wait, or a screening note. Reference for clinicians; never run automatically.
 */
export const kbRedFlagPresentation = pgTable(
  'kb_red_flag_presentation',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    kbVersionId: uuid('kb_version_id')
      .notNull()
      .references(() => kbVersion.id),
    region: kbRegion('region').notNull(),
    rowNumber: integer('row_number').notNull(),
    kind: kbRedFlagRowKind('kind').notNull(),
    /** The presentation, or the note's text. */
    presentation: text('presentation').notNull(),
    features: text('features'),
    action: text('action'),
    why: text('why'),
  },
  (table) => [
    unique('kb_red_flag_presentation_row_key').on(table.kbVersionId, table.region, table.rowNumber),
    check(
      'kb_red_flag_presentation_kind',
      sql`${table.kind} = 'screening_note' or (${table.features} is not null and ${table.action} is not null)`,
    ),
  ],
).enableRLS();

export const kbMeasureKind = pgEnum('kb_measure_kind', measureKinds);

/**
 * A measure of a workbook's Progress Tracker (CLN-05): what the Objective records, its unit, and
 * how the workbook's formula reads it (LSI, deficit, against a reference, or a value with its
 * direction; a 0 to 3 grade). Word for word from the workbook.
 */
export const kbMeasure = pgTable(
  'kb_measure',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    kbVersionId: uuid('kb_version_id')
      .notNull()
      .references(() => kbVersion.id),
    region: kbRegion('region').notNull(),
    /** Stable across versions while the row keeps its name, for example `knee.lsi.quadriceps`. */
    key: text('key').notNull(),
    section: text('section').notNull(),
    name: text('name').notNull(),
    unit: text('unit').notNull(),
    kind: kbMeasureKind('kind').notNull(),
    /** A timed test: LSI is uninvolved / involved. */
    inverted: boolean('inverted').notNull(),
    rule: jsonb('rule').$type<MeasureRule>().notNull(),
    direction: text('direction'),
    note: text('note'),
    rowNumber: integer('row_number').notNull(),
  },
  (table) => [
    unique('kb_measure_version_key').on(table.kbVersionId, table.key),
    check('kb_measure_key', sql`${table.key} ~ '^[a-z_]+[.][a-z0-9_.]+$'`),
  ],
).enableRLS();

/** A row of a workbook's Special Tests sheet (CLN-05), word for word. */
export const kbSpecialTest = pgTable(
  'kb_special_test',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    kbVersionId: uuid('kb_version_id')
      .notNull()
      .references(() => kbVersion.id),
    region: kbRegion('region').notNull(),
    key: text('key').notNull(),
    category: text('category').notNull(),
    test: text('test').notNull(),
    targets: text('targets').notNull(),
    positiveFinding: text('positive_finding').notNull(),
    clinicalNote: text('clinical_note').notNull(),
    rowNumber: integer('row_number').notNull(),
  },
  (table) => [
    unique('kb_special_test_version_key').on(table.kbVersionId, table.key),
    check('kb_special_test_key', sql`${table.key} ~ '^[a-z_]+[.][a-z0-9_.]+$'`),
  ],
).enableRLS();
