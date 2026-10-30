import 'server-only';
import { createHash } from 'node:crypto';
import {
  aiSpendSince,
  blindTestSpend,
  insertAiRun,
  openAiSpendCapTask,
  patientContentSpend,
  type Db,
  type NewAiRun,
} from '@clinic-mx/db';
import {
  aiPatientContentInputSchema,
  aiPatientContentOutputSchema,
  aiPromptsWithLimit,
  aiPromptsWithSimilarCases,
  aiRankInputSchema,
  aiRankOutputSchema,
  aiRecheckInputSchema,
  istDate,
  microUsdToPaise,
  namesBlockedProvider,
  pinnedAiTasks,
  startOfIstDay,
  type AiPromptVersion,
  type AiRunStatus,
  type AiTaskConfig,
} from '@clinic-mx/schemas';
import { z } from 'zod';
import { systemService } from '../../access/service';
import { getSetting } from '../../settings/settings';
import { outboundAllowed, textsOf } from './guard';
import { PROMPTS } from './prompts';
import { defaultTransport, type AiRequest, type AiTransport } from './transport';

/**
 * Runs one gateway task (AI-01; TAD section 7): the input checked against the task's allow list,
 * then the outbound text against identifiers, then the daily spend cap, then at most two calls
 * (one retry: an invalid answer, a timeout, a network or provider error), and one `ai_run` row
 * whatever happened. Never throws for the model: anything but a valid answer is `unavailable`, so
 * the consultation never waits on AI. Throws only when the database does.
 */
export const AI_MAX_ATTEMPTS = 2;

const TASKS = {
  rank_diagnoses: {
    settingKey: 'ai.task_rank_diagnoses',
    input: aiRankInputSchema,
    output: aiRankOutputSchema,
  },
  recheck_with_findings: {
    settingKey: 'ai.task_recheck_with_findings',
    input: aiRecheckInputSchema,
    output: aiRankOutputSchema,
  },
  write_patient_content: {
    settingKey: 'ai.task_write_patient_content',
    input: aiPatientContentInputSchema,
    output: aiPatientContentOutputSchema,
  },
} as const;
export type GatewayTask = keyof typeof TASKS;
type Output<K extends GatewayTask> = z.infer<(typeof TASKS)[K]['output']>;

export type AiResult<T> =
  | { status: 'ok'; output: T; runId: string }
  | { status: 'unavailable'; reason: Exclude<AiRunStatus, 'ok'>; runId: string };

/** The input without what its prompt is not told about: similar cases (AI-05), a row limit. */
function forPrompt(input: unknown, promptVersion: AiPromptVersion): unknown {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return input;
  const dropped = new Set([
    ...(aiPromptsWithSimilarCases.includes(promptVersion) ? [] : ['similar']),
    ...(aiPromptsWithLimit.includes(promptVersion) ? [] : ['limit']),
  ]);
  return Object.fromEntries(Object.entries(input).filter(([key]) => !dropped.has(key)));
}

/** JSON with keys in order, so the same input always hashes the same. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map(
        (key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`,
      )
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

/** What strict structured output accepts from every candidate provider: shapes, not bounds. */
const PORTABLE_KEYWORDS = new Set([
  'type',
  'properties',
  'required',
  'additionalProperties',
  'items',
]);

/**
 * The output schema as sent: the task's zod schema without its bounds (lengths, limits, counts,
 * `$schema`), which some strict providers refuse. The bounds are still checked on the answer.
 */
export function portableSchema(schema: z.ZodType): unknown {
  const strip = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(strip);
    if (!node || typeof node !== 'object') return node;
    return Object.fromEntries(
      Object.entries(node)
        .filter(([key]) => PORTABLE_KEYWORDS.has(key))
        .map(([key, value]) =>
          key === 'properties'
            ? [
                key,
                Object.fromEntries(Object.entries(value as object).map(([k, v]) => [k, strip(v)])),
              ]
            : [key, strip(value)],
        ),
    );
  };
  return strip(z.toJSONSchema(schema));
}

/**
 * The request for a task: zero data retention and no data collection always; pinned for a clinical
 * task and for patient content (`pinnedAiTasks`).
 */
export function buildRequest(
  task: GatewayTask,
  config: AiTaskConfig & { model: string },
  inputJson: string,
): AiRequest {
  const pinned = pinnedAiTasks.includes(task);
  return {
    model: config.model,
    messages: [
      { role: 'system', content: PROMPTS[config.promptVersion] },
      { role: 'user', content: inputJson },
    ],
    provider: {
      zdr: true,
      data_collection: 'deny',
      require_parameters: true,
      ...(pinned ? { order: [...config.providers], allow_fallbacks: false as const } : {}),
    },
    response_format: {
      type: 'json_schema',
      json_schema: { name: task, strict: true, schema: portableSchema(TASKS[task].output) },
    },
    max_tokens: config.maxTokens,
    ...(config.reasoningEffort === 'none' ? {} : { reasoning: { effort: config.reasoningEffort } }),
  };
}

const recordRun = systemService({
  component: 'ai',
  input: z.custom<NewAiRun>(),
  run: (tx, run) => insertAiRun(tx, run),
});

const raiseSpendCap = systemService({
  component: 'ai',
  input: z.object({ capPaise: z.number(), spentPaise: z.string(), day: z.string() }),
  run: (tx, details) => openAiSpendCapTask(tx, details),
});

export interface RunOptions {
  episodeId: string | null;
  kbVersionId: string | null;
  /** The patient's own name words: never sent. */
  forbidden?: readonly string[];
  transport?: AiTransport | null;
  now?: Date;
  /**
   * A blind test run (AI-06): the candidate's settings in place of the task's, for this call only,
   * its own budget, and the run tagged. Only `rankForBlindTest` passes it.
   */
  blindTest?: { runId: string; config: AiTaskConfig & { model: string } };
  /**
   * The operator's one-time patient content run (AI-07): the model and hosts named for the run in
   * place of the task's. Only `writePatientContent` passes it.
   */
  config?: AiTaskConfig & { model: string };
}

export async function runTask<K extends GatewayTask>(
  db: Db,
  task: K,
  rawInput: unknown,
  options: RunOptions,
): Promise<AiResult<Output<K>>> {
  const started = Date.now();
  const now = options.now ?? new Date();
  // A blind test (AI-06) runs its candidate's settings for this run only; nothing is stored.
  if (options.blindTest && (options.episodeId !== null || task !== 'rank_diagnoses')) {
    throw new Error('A blind test ranks anonymised cases only, outside any episode.');
  }
  if (options.config && (options.episodeId !== null || task !== 'write_patient_content')) {
    throw new Error('Only patient content is written with a model named for the run.');
  }
  const config =
    options.blindTest?.config ?? options.config ?? (await getSetting(TASKS[task].settingKey));
  // Similar cases (AI-05) and a row limit (AI-03) go only to a prompt that is told about them.
  const parsed = TASKS[task].input.safeParse(forPrompt(rawInput, config.promptVersion));
  const inputJson = canonicalJson(parsed.success ? parsed.data : rawInput);
  const base = {
    kind: task,
    episodeId: options.episodeId,
    kbVersionId: options.kbVersionId,
    model: config.model,
    promptVersion: config.promptVersion,
    inputHash: createHash('sha256').update(inputJson).digest('hex'),
    blindTestRun: options.blindTest?.runId ?? null,
  } satisfies Partial<NewAiRun>;

  const finish = async (
    status: AiRunStatus,
    extra: Partial<NewAiRun> = {},
    output?: Output<K>,
  ): Promise<AiResult<Output<K>>> => {
    const runId = await recordRun(db, {
      ...base,
      input: {},
      attempts: 0,
      latencyMs: Date.now() - started,
      ...extra,
      status,
    });
    return status === 'ok' && output
      ? { status: 'ok', output, runId }
      : { status: 'unavailable', reason: status as Exclude<AiRunStatus, 'ok'>, runId };
  };

  if (!parsed.success) return finish('blocked');
  const transport = options.transport === undefined ? defaultTransport() : options.transport;
  const model = config.model;
  if (!transport || !model || (pinnedAiTasks.includes(task) && config.providers.length === 0)) {
    return finish('not_configured');
  }
  // Never a blocked provider for a clinical call (PRD: DeepSeek's own API never gets patient data).
  if (
    pinnedAiTasks.includes(task) &&
    namesBlockedProvider(config.providers, await getSetting('ai.blocked_providers'))
  ) {
    return finish('not_configured');
  }
  if (!outboundAllowed(textsOf(parsed.data), options.forbidden)) return finish('blocked');

  const rate = await getSetting('ai.usd_rate_paise');
  if (task === 'write_patient_content') {
    // Patient content is written once, with its own budget; never the daily cap (AI-07).
    const spentOnContent = microUsdToPaise(await patientContentSpend(db), rate);
    if (spentOnContent >= BigInt(await getSetting('ai.patient_content_budget_paise'))) {
      return finish('capped');
    }
  } else if (options.blindTest) {
    // A blind test has its own budget; it never stops the live sheet or tells the Super Admin.
    const spentOnTest = microUsdToPaise(await blindTestSpend(db, options.blindTest.runId), rate);
    if (spentOnTest >= BigInt(await getSetting('ai.blind_test_budget_paise'))) {
      return finish('capped');
    }
  } else {
    const capPaise = await getSetting('ai.daily_spend_cap_paise');
    const day = istDate(now);
    const spent = microUsdToPaise(await aiSpendSince(db, startOfIstDay(day)), rate);
    if (spent >= BigInt(capPaise)) {
      await raiseSpendCap(db, { capPaise, spentPaise: spent.toString(), day });
      return finish('capped');
    }
  }

  const request = buildRequest(task, { ...config, model }, inputJson);
  let status: AiRunStatus = 'failed';
  let output: Output<K> | undefined;
  let attempts = 0;
  let cost: bigint | null = null;
  const used = {
    model: null as string | null,
    provider: null as string | null,
    tokensIn: 0,
    tokensOut: 0,
  };
  while (attempts < AI_MAX_ATTEMPTS && status !== 'ok') {
    attempts += 1;
    const result = await transport.complete(request, AbortSignal.timeout(config.timeoutMs));
    if (!result.ok) {
      status = result.failure === 'timeout' ? 'timed_out' : 'failed';
      continue;
    }
    if (result.costMicroUsd !== null) cost = (cost ?? 0n) + result.costMicroUsd;
    used.model = result.model ?? used.model;
    used.provider = result.provider ?? used.provider;
    used.tokensIn += result.tokensIn ?? 0;
    used.tokensOut += result.tokensOut ?? 0;
    let answer: unknown;
    try {
      answer = JSON.parse(result.content);
    } catch {
      status = 'invalid_output';
      continue;
    }
    const valid = TASKS[task].output.safeParse(answer);
    if (valid.success) {
      status = 'ok';
      output = valid.data as Output<K>;
    } else {
      status = 'invalid_output';
    }
  }
  return finish(
    status,
    {
      input: parsed.data,
      output: output ?? null,
      attempts,
      model: used.model ?? model,
      provider: used.provider,
      costMicroUsd: cost,
      tokensIn: used.tokensIn || null,
      tokensOut: used.tokensOut || null,
    },
    output,
  );
}
