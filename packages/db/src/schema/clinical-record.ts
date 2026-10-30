import {
  clearanceStatuses,
  confirmedDiagnosisStages,
  criterionResults,
  interventionKinds,
  irritabilities,
  phaseMarkResults,
  phaseMoveKinds,
  specialTestResults,
  stages,
  type ClearanceCriterion,
} from '@clinic-mx/schemas';
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
import { kbCondition, kbRegion, kbVersion } from './knowledge';
// Circular with ./sessions, which is safe: references are read lazily.
import { treatmentSession } from './sessions';

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
    /**
     * The consultation that took it, or else the session (OUT-01: session 1's baseline), or else
     * the episode's final testing (OUT-07).
     */
    consultationId: uuid('consultation_id').references(() => consultation.id),
    sessionId: uuid('session_id').references(() => treatmentSession.id),
    finalTestId: uuid('final_test_id').references(() => finalTest.id),
    /** Or a reading taken on the readiness panel (OUT-08). */
    readinessRecordingId: uuid('readiness_recording_id').references(() => readinessRecording.id),
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
  (table) => [
    index('measure_episode_idx').on(table.episodeId, table.measureKey),
    index('measure_session_idx').on(table.sessionId),
    index('measure_final_test_idx').on(table.finalTestId),
    index('measure_readiness_recording_idx').on(table.readinessRecordingId),
    check(
      'measure_taken_in',
      sql`num_nonnulls(${table.consultationId}, ${table.sessionId}, ${table.finalTestId}, ${table.readinessRecordingId}) = 1`,
    ),
  ],
).enableRLS();

/**
 * The episode's baseline (OUT-01, PRD J5.3), written once when session 1 is signed and never
 * changed, so final testing (OUT-07) lists exactly these measures. Each is reused from a
 * consultation, recorded in the session (its `measure` rows), or not tested with a reason.
 */
export const baselineMeasure = pgTable(
  'baseline_measure',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    episodeId: uuid('episode_id')
      .notNull()
      .references(() => episode.id),
    /** Session 1, whose signing wrote it. */
    sessionId: uuid('session_id')
      .notNull()
      .references(() => treatmentSession.id),
    kbVersionId: uuid('kb_version_id')
      .notNull()
      .references(() => kbVersion.id),
    measureKey: text('measure_key').notNull(),
    /** The consultation whose reading is reused; null when session 1 recorded it or not. */
    consultationId: uuid('consultation_id').references(() => consultation.id),
    notTestedReason: text('not_tested_reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('baseline_measure_episode_key').on(table.episodeId, table.measureKey),
    check(
      'baseline_measure_source',
      sql`${table.consultationId} is null or ${table.notTestedReason} is null`,
    ),
    check(
      'baseline_measure_reason',
      sql`${table.notTestedReason} is null or length(trim(${table.notTestedReason})) between 1 and 200`,
    ),
  ],
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

/**
 * The session 4 reassessment (OUT-05, PRD J5.10): written when session `clinical.reassessment_session`
 * is signed, its readings that session's `measure` rows and the measures not tested here with
 * their reasons; the episode's consultant (stamped by the database) then signs a written decision.
 * Nothing else ever changes, and it is never deleted.
 */
export const reassessment = pgTable(
  'reassessment',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    episodeId: uuid('episode_id')
      .notNull()
      .references(() => episode.id),
    sessionId: uuid('session_id')
      .notNull()
      .unique()
      .references(() => treatmentSession.id),
    kbVersionId: uuid('kb_version_id')
      .notNull()
      .references(() => kbVersion.id),
    /** Who reviews and signs: the episode's consultant, set by the database. */
    consultantId: uuid('consultant_id')
      .notNull()
      .references(() => staffUser.id),
    /** Measures not tested at this session, by key, with the reason. */
    notTested: jsonb('not_tested').$type<Record<string, string>>().notNull().default({}),
    decision: text('decision'),
    signedBy: uuid('signed_by').references(() => staffUser.id),
    signedAt: timestamp('signed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check(
      'reassessment_signed',
      sql`(${table.decision} is null) = (${table.signedBy} is null) and (${table.signedBy} is null) = (${table.signedAt} is null)`,
    ),
    check(
      'reassessment_decision',
      sql`${table.decision} is null or length(trim(${table.decision})) between 1 and 2000`,
    ),
  ],
).enableRLS();

/**
 * The episode's final testing (OUT-07, PRD J6.2): exactly the baseline's measures retested on the
 * Review and discharge screen, once, by anyone with the Consultant tick, and signed as it is
 * written (`internal.final_test_guard`). Its readings are `measure` rows of it; it never changes.
 */
export const finalTest = pgTable('final_test', {
  id: uuid('id').primaryKey().defaultRandom(),
  episodeId: uuid('episode_id')
    .notNull()
    .unique()
    .references(() => episode.id),
  /** The baseline's version, so the measure keys are the baseline's. */
  kbVersionId: uuid('kb_version_id')
    .notNull()
    .references(() => kbVersion.id),
  /** Measures not tested, by key, with the reason. */
  notTested: jsonb('not_tested').$type<Record<string, string>>().notNull().default({}),
  signedBy: uuid('signed_by')
    .notNull()
    .references(() => staffUser.id),
  signedAt: timestamp('signed_at', { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}).enableRLS();

export const readinessMarkKind = pgEnum('readiness_mark_kind', ['check', 'override']);
export const criterionResult = pgEnum('criterion_result', criterionResults);
export const clearanceStatus = pgEnum('clearance_status', clearanceStatuses);

/**
 * A reading taken on the readiness panel (OUT-08) for a measured criterion the episode never
 * measured: its `measure` rows point here. Written by a consultant; never changed.
 */
export const readinessRecording = pgTable('readiness_recording', {
  id: uuid('id').primaryKey().defaultRandom(),
  episodeId: uuid('episode_id')
    .notNull()
    .references(() => episode.id),
  kbVersionId: uuid('kb_version_id')
    .notNull()
    .references(() => kbVersion.id),
  recordedBy: uuid('recorded_by')
    .notNull()
    .references(() => staffUser.id),
  recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull().defaultNow(),
}).enableRLS();

/**
 * A consultant's mark on a readiness criterion (OUT-08, TAD `criterion_result`): a yes or no
 * criterion's result, or an override of one not Met with its written reason. Appended, never
 * changed; the latest of each kind per criterion counts.
 */
export const readinessMark = pgTable(
  'readiness_mark',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    episodeId: uuid('episode_id')
      .notNull()
      .references(() => episode.id),
    kbVersionId: uuid('kb_version_id')
      .notNull()
      .references(() => kbVersion.id),
    criterionKey: text('criterion_key').notNull(),
    kind: readinessMarkKind('kind').notNull(),
    /** A check's result; null for an override. */
    result: criterionResult('result'),
    /** An override's written reason; null for a check. */
    reason: text('reason'),
    markedBy: uuid('marked_by')
      .notNull()
      .references(() => staffUser.id),
    markedAt: timestamp('marked_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('readiness_mark_episode_idx').on(table.episodeId, table.criterionKey, table.markedAt),
    check(
      'readiness_mark_shape',
      sql`(${table.kind} = 'check' and ${table.result} is not null and ${table.reason} is null)
        or (${table.kind} = 'override' and ${table.result} is null
          and length(trim(${table.reason})) between 1 and 1000)`,
    ),
  ],
).enableRLS();

/**
 * One of the episode's three clearances (OUT-08, PRD J6.4, TAD `clearance`): signed once each, in
 * order, by a consultant, keeping every criterion as it stood (result, reading, override).
 */
export const clearance = pgTable(
  'clearance',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    episodeId: uuid('episode_id')
      .notNull()
      .references(() => episode.id),
    status: clearanceStatus('status').notNull(),
    /** The workbook region whose criteria it was judged against, at that version. */
    region: kbRegion('region').notNull(),
    kbVersionId: uuid('kb_version_id')
      .notNull()
      .references(() => kbVersion.id),
    criteria: jsonb('criteria').$type<ClearanceCriterion[]>().notNull(),
    signedBy: uuid('signed_by')
      .notNull()
      .references(() => staffUser.id),
    signedAt: timestamp('signed_at', { withTimezone: true }).notNull().defaultNow(),
    /**
     * What the patient acknowledges (OUT-09), in the consultant's words: Return to training and
     * Return to sport only (`clearance_texts`, for clearances signed from OUT-09 on).
     */
    patientPlan: text('patient_plan'),
    warningSigns: text('warning_signs'),
    residualRisk: text('residual_risk'),
  },
  (table) => [unique('clearance_episode_status').on(table.episodeId, table.status)],
).enableRLS();

export const phaseMarkResult = pgEnum('phase_mark_result', phaseMarkResults);
export const phaseMoveKind = pgEnum('phase_move_kind', phaseMoveKinds);

/**
 * The treating physio's mark on an exit criterion of the episode's current phase (OUT-04): Met or
 * Not yet. Appended, never changed; the latest per criterion since the phase was entered counts.
 */
export const phaseMark = pgTable(
  'phase_mark',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    episodeId: uuid('episode_id')
      .notNull()
      .references(() => episode.id),
    kbVersionId: uuid('kb_version_id')
      .notNull()
      .references(() => kbVersion.id),
    criterionKey: text('criterion_key').notNull(),
    result: phaseMarkResult('result').notNull(),
    markedBy: uuid('marked_by')
      .notNull()
      .references(() => staffUser.id),
    markedAt: timestamp('marked_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('phase_mark_episode_idx').on(table.episodeId, table.markedAt)],
).enableRLS();

/**
 * A move of the episode between phases (OUT-04): the treating physio's progress one phase on once
 * every exit criterion is Met, or a consultant's override to any other phase with its reason.
 * Without a move the episode is in Phase 0. Appended, never changed.
 */
export const phaseMove = pgTable(
  'phase_move',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    episodeId: uuid('episode_id')
      .notNull()
      .references(() => episode.id),
    kbVersionId: uuid('kb_version_id')
      .notNull()
      .references(() => kbVersion.id),
    region: kbRegion('region').notNull(),
    fromPhase: integer('from_phase').notNull(),
    toPhase: integer('to_phase').notNull(),
    kind: phaseMoveKind('kind').notNull(),
    /** An override's written reason; null for a progress. */
    reason: text('reason'),
    movedBy: uuid('moved_by')
      .notNull()
      .references(() => staffUser.id),
    movedAt: timestamp('moved_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('phase_move_episode_idx').on(table.episodeId, table.movedAt),
    unique('phase_move_episode_moved_at').on(table.episodeId, table.movedAt),
    check(
      'phase_move_shape',
      sql`${table.fromPhase} >= 0 and ${table.toPhase} >= 0 and (
        (${table.kind} = 'progress' and ${table.toPhase} = ${table.fromPhase} + 1
          and ${table.reason} is null)
        or (${table.kind} = 'override' and ${table.toPhase} <> ${table.fromPhase}
          and length(trim(${table.reason})) between 1 and 1000))`,
    ),
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

/**
 * A change to a signed consultation or session note, written after (TAD `addendum`, rule 5): it
 * belongs to exactly one of them.
 */
export const addendum = pgTable(
  'addendum',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    consultationId: uuid('consultation_id').references(() => consultation.id),
    sessionId: uuid('session_id').references(() => treatmentSession.id),
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
    index('addendum_session_idx').on(table.sessionId, table.createdAt),
    check('addendum_note', sql`num_nonnulls(${table.consultationId}, ${table.sessionId}) = 1`),
    check('addendum_text', sql`length(trim(${table.text})) between 1 and 5000`),
  ],
).enableRLS();

export const confirmedDiagnosisStage = pgEnum(
  'confirmed_diagnosis_stage',
  confirmedDiagnosisStages,
);

/**
 * The diagnosis confirmed at review or discharge (AI-05; PRD section 6: the learning label, "not
 * the first impression"): the signed diagnosis confirmed, or changed to another condition of its
 * knowledge base version, by a consultant with the Treats patients tick. Never changed; a later
 * confirmation is the label. The database stamps the stage, who and when.
 */
export const confirmedDiagnosis = pgTable(
  'confirmed_diagnosis',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    episodeId: uuid('episode_id')
      .notNull()
      .references(() => episode.id),
    /** The signed diagnosis it confirms or changes: the episode's latest at the time. */
    sourceDiagnosisId: uuid('source_diagnosis_id')
      .notNull()
      .references(() => diagnosis.id),
    kbVersionId: uuid('kb_version_id')
      .notNull()
      .references(() => kbVersion.id),
    conditionId: text('condition_id').notNull(),
    stage: confirmedDiagnosisStage('stage').notNull(),
    confirmedBy: uuid('confirmed_by')
      .notNull()
      .references(() => staffUser.id),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      name: 'confirmed_diagnosis_condition_fkey',
      columns: [table.kbVersionId, table.conditionId],
      foreignColumns: [kbCondition.kbVersionId, kbCondition.conditionId],
    }),
    index('confirmed_diagnosis_episode_idx').on(table.episodeId, table.confirmedAt),
  ],
).enableRLS();
