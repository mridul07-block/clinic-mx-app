import { parseArgs } from 'node:util';
import { aiTaskConfigSchema, type AiTaskConfig } from '@clinic-mx/schemas';
import { checkTask, type AiCheckResult } from '../modules/ai/gateway';
import type { GatewayTask } from '../modules/ai/gateway/run';
import { openRouterKeyStatus, openRouterTransport } from '../modules/ai/gateway/transport';
import { getSetting } from '../modules/settings/settings';

// The live check (AI-01): `pnpm ai:check [--model <vendor/model> --provider <host> ...]`. With no
// model, it checks each task whose settings name one; with a model, that candidate as the sheet
// would run it. One made-up case per call, nothing written, only the outcome printed
// (docs/runbooks/ai-gateway.md).
const usage =
  'Usage: pnpm ai:check [--model <vendor/model> --provider <host> [--provider <host>] [--timeout-ms <n>]]';

class CheckError extends Error {}

const usd = (value: number | null) => (value === null ? 'none' : `$${value.toFixed(4)}`);
const line = (label: string, result: AiCheckResult) =>
  [
    label.padEnd(28),
    result.status.padEnd(16),
    (result.provider ?? '-').padEnd(16),
    `${String(result.latencyMs)} ms`.padEnd(10),
    result.costMicroUsd === null ? 'cost unknown' : usd(Number(result.costMicroUsd) / 1e6),
    result.httpStatus === undefined ? '' : `HTTP ${String(result.httpStatus)}`,
  ].join(' ');

async function main() {
  const { values } = parseArgs({
    options: {
      model: { type: 'string' },
      provider: { type: 'string', multiple: true },
      'timeout-ms': { type: 'string' },
    },
  });
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new CheckError('Set OPENROUTER_API_KEY first.');

  const status = await openRouterKeyStatus(key);
  if (!status) throw new CheckError('OpenRouter did not accept the key.');
  console.log(
    `Key: used ${usd(status.usageUsd)}, limit ${usd(status.limitUsd)}, left ${usd(status.remainingUsd)}`,
  );
  if (status.limitUsd === null) {
    console.log(
      'Warning: the key has no credit limit. Set one on OpenRouter: it is the only hard stop, because a timed out call is billed without its cost coming back.',
    );
  }

  const targets: { label: string; task: GatewayTask; config: AiTaskConfig }[] = [];
  if (values.model) {
    const base = await getSetting('ai.task_rank_diagnoses');
    const parsed = aiTaskConfigSchema.safeParse({
      ...base,
      model: values.model,
      providers: values.provider ?? [],
      timeoutMs: values['timeout-ms'] ? Number(values['timeout-ms']) : base.timeoutMs,
    });
    if (!parsed.success || (values.provider ?? []).length === 0) throw new CheckError(usage);
    targets.push({ label: values.model, task: 'rank_diagnoses', config: parsed.data });
  } else {
    targets.push(
      {
        label: 'rank_diagnoses',
        task: 'rank_diagnoses',
        config: await getSetting('ai.task_rank_diagnoses'),
      },
      {
        label: 'recheck_with_findings',
        task: 'recheck_with_findings',
        config: await getSetting('ai.task_recheck_with_findings'),
      },
    );
  }

  const transport = openRouterTransport(key);
  const blockedProviders = await getSetting('ai.blocked_providers');
  let failed = false;
  for (const { label, task, config } of targets) {
    const { model } = config;
    if (!model || config.providers.length === 0) {
      console.log(`${label.padEnd(28)} not configured (no model or pinned host in its settings)`);
      continue;
    }
    const result = await checkTask(task, { ...config, model }, { transport, blockedProviders });
    console.log(line(label, result));
    failed ||= result.status !== 'ok';
  }
  if (failed) process.exitCode = 2;
}

main()
  .then(() => process.exit())
  .catch((error: unknown) => {
    console.error(error instanceof CheckError ? error.message : 'The check stopped.');
    process.exit(1);
  });
