import { z } from 'zod';
import { patientSexes } from './patients';
import { screeningRegions } from './red-flags';

/**
 * The AI gateway (AI-01; TAD section 7 "AI gateway"; PRD section 6 "Models and privacy"): every
 * model call goes through one module with one function per task, each with its model, prompt
 * version, reasoning effort, timeout and token limit in settings. Only what a task's input schema
 * allows is ever sent (TAD: "only age, sex, region, symptoms, duration, sport and goal"; no names,
 * phone numbers or IDs, rule 11), and every run is logged to `ai_run`. Recommended defaults chosen
 * under the user's standing approval, 28 October 2026 (DECISION AI-01 in docs/PROGRESS.md;
 * docs/runbooks/ai-gateway.md).
 */

/** Every task the gateway runs (TAD: rankDiagnoses, recheckWithFindings, assistantReply, tagFeedback). */
export const aiTasks = [
  'rank_diagnoses',
  'recheck_with_findings',
  'assistant_reply',
  'tag_feedback',
] as const;
export type AiTask = (typeof aiTasks)[number];

/** Tasks that suggest diagnoses: behind the AI gate (AI-09), on pinned providers only. */
export const clinicalAiTasks: readonly AiTask[] = ['rank_diagnoses', 'recheck_with_findings'];

/** How a run ended; anything but `ok` shows "Suggestions unavailable" on the sheet. */
export const aiRunStatuses = [
  'ok',
  'invalid_output',
  'failed',
  'timed_out',
  'capped',
  'blocked',
  'not_configured',
] as const;
export type AiRunStatus = (typeof aiRunStatuses)[number];

/** Each prompt by version; the text lives in apps/web/modules/ai/gateway/prompts.ts. */
export const aiPromptVersions = ['rank_diagnoses.v1', 'recheck_with_findings.v1'] as const;
export type AiPromptVersion = (typeof aiPromptVersions)[number];

/** A task’s settings (`ai.task_<task>`). No model until the blind test chooses one (AI-06). */
export const aiTaskConfigSchema = z.strictObject({
  /** An OpenRouter model, for example "vendor/model"; null: not configured, nothing is called. */
  model: z
    .string()
    .regex(/^[a-z0-9-]+\/[a-z0-9._:-]+$/)
    .nullable(),
  /** The providers a clinical task is pinned to, in order; never others (no fallbacks). */
  providers: z.array(z.string().min(1)).max(3),
  promptVersion: z.enum(aiPromptVersions),
  reasoningEffort: z.enum(['none', 'low', 'medium', 'high']),
  timeoutMs: z.int().min(1000).max(20000),
  maxTokens: z.int().min(1).max(4000),
});
export type AiTaskConfig = z.infer<typeof aiTaskConfigSchema>;

/** The longest text a case or finding may send, and the most findings in a recheck. */
export const AI_TEXT_MAX = 200;
export const AI_FINDINGS_MAX = 40;

const shortText = z.string().max(AI_TEXT_MAX);

/**
 * The case a clinical task may send: exactly what the TAD lists, nothing else (strict, so a name,
 * phone number or ID field is refused before any call).
 */
export const aiCaseSchema = z.strictObject({
  age: z.int().min(0).max(120).nullable(),
  sex: z.enum(patientSexes).nullable(),
  region: z.enum(screeningRegions),
  symptoms: z.array(shortText).max(20),
  durationWeeks: z.number().nonnegative().max(5200).nullable(),
  sport: z.array(shortText).max(20),
  goal: shortText.nullable(),
});
export type AiCase = z.infer<typeof aiCaseSchema>;

/**
 * A shortlist row as sent: numbered 1 to N (the gateway maps the number back to its condition),
 * with the knowledge base's own words for it.
 */
export const aiRankRowSchema = z.strictObject({
  n: z.int().positive(),
  name: z.string().max(200),
  mustRuleOut: z.boolean(),
  age: z.string().max(200).nullable(),
  onset: z.string().max(200).nullable(),
  sex: z.string().max(200).nullable(),
  symptoms: z.string().max(2000).nullable(),
});
export type AiRankRow = z.infer<typeof aiRankRowSchema>;

export const aiRankInputSchema = z.strictObject({
  case: aiCaseSchema,
  rows: z.array(aiRankRowSchema).min(1).max(60),
});
export type AiRankInput = z.infer<typeof aiRankInputSchema>;

/** The recheck adds the examination findings (AI-04 settles their shape). */
export const aiRecheckInputSchema = z.strictObject({
  case: aiCaseSchema,
  rows: z.array(aiRankRowSchema).min(1).max(60),
  findings: z.array(shortText).max(AI_FINDINGS_MAX),
});
export type AiRecheckInput = z.infer<typeof aiRecheckInputSchema>;

/** What the model returns: shortlist numbers, most likely first, each with a one line reason. */
export const aiRankOutputSchema = z.strictObject({
  ranked: z
    .array(z.strictObject({ n: z.int().positive(), reason: z.string().min(1).max(160) }))
    .min(1)
    .max(60),
});
export type AiRankOutput = z.infer<typeof aiRankOutputSchema>;

/** A USD charge in millionths of a dollar as paise at `ratePaise` per dollar, rounded up. */
export function microUsdToPaise(microUsd: bigint, ratePaise: number): bigint {
  const product = microUsd * BigInt(ratePaise);
  const million = 1_000_000n;
  return product / million + (product % million === 0n ? 0n : 1n);
}

/** OpenRouter's `usage.cost` (USD credits) as whole millionths of a dollar. */
export function usdToMicroUsd(cost: unknown): bigint | null {
  if (typeof cost !== 'number' || !Number.isFinite(cost) || cost < 0) return null;
  return BigInt(Math.round(cost * 1_000_000));
}
