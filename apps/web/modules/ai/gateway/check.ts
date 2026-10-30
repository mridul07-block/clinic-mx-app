import 'server-only';
import { aiRankOutputSchema, namesBlockedProvider, type AiTaskConfig } from '@clinic-mx/schemas';
import { buildRequest, canonicalJson, type GatewayTask } from './run';
import type { AiTransport } from './transport';

/**
 * The operator's live check (AI-01, `pnpm ai:check`): one call per configured task, or per
 * candidate before it is adopted, with a fixed made-up case, through the gateway's own request
 * (zero data retention, no data collection, the pinned hosts with no fallbacks, the strict schema).
 * It answers whether OpenRouter takes the request, whether a pinned host answered, how fast and at
 * what cost. No patient data and no knowledge base text is sent, and nothing is written: it runs
 * no task, so it is not an `ai_run`.
 */
const checkCase = {
  age: 30,
  sex: null,
  region: 'knee',
  symptoms: ['Check symptom one', 'Check symptom two'],
  durationWeeks: 4,
  sport: [],
  goal: null,
} as const;

const checkRows = [1, 2, 3].map((n) => ({
  n,
  name: `Check condition ${String(n)}`,
  mustRuleOut: false,
  age: null,
  onset: null,
  sex: null,
  symptoms: n === 1 ? 'Check symptom one, check symptom two' : `Check symptom ${String(n + 1)}`,
}));

/** The made-up input each task is checked with. */
export function checkInput(task: GatewayTask): unknown {
  return task === 'recheck_with_findings'
    ? { case: checkCase, rows: checkRows, findings: ['Check finding'], similar: [] }
    : { case: checkCase, rows: checkRows, similar: [] };
}

export type AiCheckStatus =
  'ok' | 'not_pinned' | 'invalid_output' | 'timed_out' | 'failed' | 'blocked_provider';

export interface AiCheckResult {
  status: AiCheckStatus;
  /** The host that answered, as OpenRouter names it ("Sail Research"). */
  provider: string | null;
  latencyMs: number;
  costMicroUsd: bigint | null;
  httpStatus?: number;
}

const letters = (text: string) => text.toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * Whether the host that answered is a pinned one, from its display name ("Sail Research", "Z.AI",
 * "NovitaAI") against the part of each tag before the slash ("sail-research", "z-ai", "novita"),
 * letters and digits only. The region of a tag ("/us") is not in the answer, so it is not checked.
 */
export function answeredByPinned(provider: string | null, pinned: readonly string[]): boolean {
  const name = letters(provider ?? '');
  if (!name) return false;
  return pinned.some((tag) => {
    const host = letters(tag.split('/')[0] ?? '');
    return host !== '' && name.startsWith(host);
  });
}

export async function checkTask(
  task: GatewayTask,
  config: AiTaskConfig & { model: string },
  options: { transport: AiTransport; blockedProviders: readonly string[] },
): Promise<AiCheckResult> {
  if (config.providers.length === 0) throw new Error('A check needs the pinned hosts.');
  if (namesBlockedProvider(config.providers, options.blockedProviders)) {
    return { status: 'blocked_provider', provider: null, latencyMs: 0, costMicroUsd: null };
  }
  const request = buildRequest(task, config, canonicalJson(checkInput(task)));
  const started = Date.now();
  const result = await options.transport.complete(request, AbortSignal.timeout(config.timeoutMs));
  const latencyMs = Date.now() - started;
  if (!result.ok) {
    return {
      status: result.failure === 'timeout' ? 'timed_out' : 'failed',
      provider: null,
      latencyMs,
      costMicroUsd: null,
      ...(result.httpStatus === undefined ? {} : { httpStatus: result.httpStatus }),
    };
  }
  const answered = { provider: result.provider, latencyMs, costMicroUsd: result.costMicroUsd };
  if (!answeredByPinned(result.provider, config.providers)) {
    return { status: 'not_pinned', ...answered };
  }
  let output: unknown;
  try {
    output = JSON.parse(result.content);
  } catch {
    return { status: 'invalid_output', ...answered };
  }
  const valid = aiRankOutputSchema.safeParse(output);
  return { status: valid.success ? 'ok' : 'invalid_output', ...answered };
}
