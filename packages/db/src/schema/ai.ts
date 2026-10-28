import {
  aiDispositions,
  aiRunStatuses,
  aiSheetStatuses,
  aiSheetUnavailableReasons,
  aiSuggestionSections,
  aiTasks,
} from '@clinic-mx/schemas';
import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { episode } from './episodes';
import { staffUser } from './identity';
import { kbRegion, kbVersion } from './knowledge';

export const aiTask = pgEnum('ai_task', aiTasks);
export const aiRunStatus = pgEnum('ai_run_status', aiRunStatuses);

/**
 * Every AI gateway run (AI-01; TAD section 4 `ai_run`, section 7 "Logs every run to `ai_run`:
 * model, prompt version, kb_version, input hash, output, latency, cost"; PRD: "Every run logs
 * model, knowledge base version, inputs, outputs and dispositions"). The input is the de-identified
 * payload exactly as sent, and its hash; the output only when valid. Written only by the server
 * (`system:ai`), never changed; consultants read the runs of episodes at their centres.
 */
export const aiRun = pgTable(
  'ai_run',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    kind: aiTask('kind').notNull(),
    /** The episode a clinical run was for; none for tasks outside an episode. */
    episodeId: uuid('episode_id').references(() => episode.id),
    kbVersionId: uuid('kb_version_id').references(() => kbVersion.id),
    /** The model asked; null when none is configured. */
    model: text('model'),
    /** The provider that answered, as OpenRouter reports it. */
    provider: text('provider'),
    promptVersion: text('prompt_version').notNull(),
    /** sha256 of the canonical JSON sent (or that would have been sent). */
    inputHash: text('input_hash').notNull(),
    /** The de-identified input exactly as sent; empty when nothing was sent. */
    input: jsonb('input').notNull().default({}),
    output: jsonb('output'),
    status: aiRunStatus('status').notNull(),
    /** Calls made: 0 when refused before any, at most 2 (one retry). */
    attempts: smallint('attempts').notNull(),
    latencyMs: integer('latency_ms').notNull(),
    /** The provider's charge in millionths of a US dollar, both attempts; null when not reported. */
    costMicroUsd: bigint('cost_micro_usd', { mode: 'bigint' }),
    tokensIn: integer('tokens_in'),
    tokensOut: integer('tokens_out'),
    /** The blind test run (AI-06) this belongs to; none for a live run. */
    blindTestRun: uuid('blind_test_run'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('ai_run_created_at_idx').on(table.createdAt),
    index('ai_run_blind_test_idx')
      .on(table.blindTestRun)
      .where(sql`${table.blindTestRun} is not null`),
    check(
      'ai_run_blind_test',
      sql`${table.blindTestRun} is null or (${table.episodeId} is null and ${table.kind} = 'rank_diagnoses')`,
    ),
    index('ai_run_episode_idx').on(table.episodeId),
    check('ai_run_input_hash', sql`${table.inputHash} ~ '^[0-9a-f]{64}$'`),
    check('ai_run_attempts', sql`${table.attempts} between 0 and 2`),
    check('ai_run_latency', sql`${table.latencyMs} >= 0`),
    check('ai_run_cost', sql`${table.costMicroUsd} is null or ${table.costMicroUsd} >= 0`),
    check(
      'ai_run_clinical_version',
      sql`${table.kind} not in ('rank_diagnoses', 'recheck_with_findings') or ${table.kbVersionId} is not null`,
    ),
  ],
).enableRLS();

export const aiSheetStatus = pgEnum('ai_sheet_status', aiSheetStatuses);
export const aiSuggestionSection = pgEnum('ai_suggestion_section', aiSuggestionSections);
export const aiDisposition = pgEnum('ai_disposition', aiDispositions);

const unavailableReasons = aiSheetUnavailableReasons.map((reason) => `'${reason}'`).join(', ');

/**
 * An episode's AI preparation sheet (AI-03; TAD section 7 step 7 "Publish"): one per episode, made
 * when the health form is submitted, over the knowledge base version the AI gate was switched on
 * for. It keeps the shortlist (AI-02, with must rule out by rule) and the de-identified case the
 * model was sent; the model's suggestions are `ai_suggestion` rows. Pending while being made;
 * ready with suggestions, or unavailable with why.
 */
export const aiPreparationSheet = pgTable(
  'ai_preparation_sheet',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    episodeId: uuid('episode_id')
      .notNull()
      .unique()
      .references(() => episode.id),
    kbVersionId: uuid('kb_version_id')
      .notNull()
      .references(() => kbVersion.id),
    status: aiSheetStatus('status').notNull(),
    unavailableReason: text('unavailable_reason'),
    aiRunId: uuid('ai_run_id').references(() => aiRun.id),
    /** The shortlist (AI-02) the model ranked, with its must rule out rows. */
    shortlist: jsonb('shortlist').notNull(),
    /** The de-identified case the model was sent; null when none could be made. */
    case: jsonb('case'),
    /**
     * The similar confirmed cases (AI-05) as sent and shown: structured fields only, no IDs. Null on
     * a sheet made before them; empty when too few were found.
     */
    similar: jsonb('similar'),
    claimedAt: timestamp('claimed_at', { withTimezone: true }).notNull().defaultNow(),
    readyAt: timestamp('ready_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    /** The latest "Recheck with findings" (AI-04): its own run, beside the first ranking. */
    recheckStatus: aiSheetStatus('recheck_status'),
    recheckReason: text('recheck_reason'),
    recheckAiRunId: uuid('recheck_ai_run_id').references(() => aiRun.id),
    /** The findings sent, exactly. */
    recheckFindings: jsonb('recheck_findings'),
    recheckBy: uuid('recheck_by').references(() => staffUser.id),
    recheckClaimedAt: timestamp('recheck_claimed_at', { withTimezone: true }),
    recheckReadyAt: timestamp('recheck_ready_at', { withTimezone: true }),
  },
  (table) => [
    check(
      'ai_preparation_sheet_recheck',
      sql`(${table.recheckStatus} is null) = (${table.recheckFindings} is null)
        and (${table.recheckStatus} is null) = (${table.recheckBy} is null)
        and (${table.recheckStatus} is null) = (${table.recheckClaimedAt} is null)
        and (${table.recheckStatus} is null or (${table.recheckStatus} = 'pending') = (${table.recheckReadyAt} is null))
        and (${table.recheckStatus} is null or (${table.recheckStatus} = 'unavailable') = (${table.recheckReason} is not null))
        and (${table.recheckReason} is null or ${table.recheckReason} in (${sql.raw(unavailableReasons)}))`,
    ),
    check(
      'ai_preparation_sheet_reason',
      sql`(${table.status} = 'unavailable') = (${table.unavailableReason} is not null)
        and (${table.unavailableReason} is null or ${table.unavailableReason} in (${sql.raw(unavailableReasons)}))`,
    ),
    check(
      'ai_preparation_sheet_ready',
      sql`(${table.status} = 'pending') = (${table.readyAt} is null)`,
    ),
  ],
).enableRLS();

/**
 * One of the model's suggestions on a sheet (AI-03; TAD section 4 `ai_suggestion`: condition_id,
 * rank, reason, disposition). The visit's consultant keeps or dismisses it; nothing enters the
 * record from here (PRD: "nothing enters the record until the physio confirms it").
 */
export const aiSuggestion = pgTable(
  'ai_suggestion',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sheetId: uuid('sheet_id')
      .notNull()
      .references(() => aiPreparationSheet.id),
    aiRunId: uuid('ai_run_id')
      .notNull()
      .references(() => aiRun.id),
    conditionId: text('condition_id').notNull(),
    region: kbRegion('region').notNull(),
    rowNumber: integer('row_number').notNull(),
    rank: smallint('rank').notNull(),
    section: aiSuggestionSection('section').notNull(),
    reason: text('reason').notNull(),
    disposition: aiDisposition('disposition'),
    disposedBy: uuid('disposed_by').references(() => staffUser.id),
    disposedAt: timestamp('disposed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('ai_suggestion_sheet_idx').on(table.sheetId),
    unique('ai_suggestion_run_condition').on(table.aiRunId, table.conditionId),
    unique('ai_suggestion_run_rank').on(table.aiRunId, table.rank),
    check('ai_suggestion_condition_id', sql`${table.conditionId} ~ '^[A-Z]{3}-[0-9]{3}$'`),
    check('ai_suggestion_rank', sql`${table.rank} >= 1`),
    check('ai_suggestion_reason', sql`length(${table.reason}) between 1 and 160`),
    check(
      'ai_suggestion_disposed',
      sql`(${table.disposition} is null) = (${table.disposedBy} is null)
        and (${table.disposition} is null) = (${table.disposedAt} is null)`,
    ),
  ],
).enableRLS();

/**
 * The monthly knowledge base report (AI-08; PRD section 6; TAD: 1st of each month): one per month,
 * built by the server from counts only and kept as built. Read by the Super Admin; nobody signed in
 * writes one, and none is ever changed or deleted.
 */
export const kbReport = pgTable(
  'kb_report',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** The calendar month it covers, "2026-10", in IST. */
    month: text('month').notNull().unique(),
    /** The live knowledge base version when it was built (rule 4). */
    kbVersionId: uuid('kb_version_id').references(() => kbVersion.id),
    /** `kbReportBodySchema`: counts and knowledge base names, never a patient, episode or staff. */
    body: jsonb('body').notNull(),
    generatedAt: timestamp('generated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [check('kb_report_month', sql`${table.month} ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'`)],
).enableRLS();
