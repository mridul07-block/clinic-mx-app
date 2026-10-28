import { aiRunStatuses, aiTasks } from '@clinic-mx/schemas';
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
  uuid,
} from 'drizzle-orm/pg-core';
import { episode } from './episodes';
import { kbVersion } from './knowledge';

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
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('ai_run_created_at_idx').on(table.createdAt),
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
