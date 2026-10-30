import { describe, expect, it, vi } from 'vitest';
import { aiRankInputSchema, aiRecheckInputSchema, type AiTaskConfig } from '@clinic-mx/schemas';
import { outboundAllowed, textsOf } from './guard';
import { answeredByPinned, checkInput, checkTask } from './check';
import { openRouterKeyStatus, type AiRequest, type AiTransport } from './transport';

vi.mock('../../../lib/env', () => ({ serverEnv: () => ({}) }));

const config: AiTaskConfig & { model: string } = {
  model: 'vendor/model-1',
  providers: ['host-a/us', 'host-b'],
  promptVersion: 'rank_diagnoses.v2',
  reasoningEffort: 'none',
  timeoutMs: 6000,
  maxTokens: 800,
};

function fake(answer: Partial<{ provider: string | null; content: string }> | 'timeout' | 503) {
  const sent: AiRequest[] = [];
  const transport: AiTransport = {
    complete: (request) => {
      sent.push(request);
      if (answer === 'timeout') return Promise.resolve({ ok: false, failure: 'timeout' });
      if (answer === 503) return Promise.resolve({ ok: false, failure: 'http', httpStatus: 503 });
      return Promise.resolve({
        ok: true,
        content: answer.content ?? '{"ranked":[{"n":1,"reason":"Matches"}]}',
        model: config.model,
        provider: answer.provider === undefined ? 'Host A' : answer.provider,
        costMicroUsd: 700n,
        tokensIn: 300,
        tokensOut: 40,
      });
    },
  };
  return { transport, sent };
}
const check = (transport: AiTransport, blockedProviders: string[] = ['deepseek']) =>
  checkTask('rank_diagnoses', config, { transport, blockedProviders });

// AI-01: the operator's live check of the key and the pinned hosts, with a made-up case only.
describe('the live check', () => {
  it('sends a made-up case the gateway would send, through the gateway’s own request', async () => {
    expect(aiRankInputSchema.safeParse(checkInput('rank_diagnoses')).success).toBe(true);
    expect(aiRecheckInputSchema.safeParse(checkInput('recheck_with_findings')).success).toBe(true);
    expect(outboundAllowed(textsOf(checkInput('recheck_with_findings')))).toBe(true);
    const { transport, sent } = fake({});
    expect(await check(transport)).toMatchObject({
      status: 'ok',
      provider: 'Host A',
      costMicroUsd: 700n,
    });
    expect(sent).toHaveLength(1);
    expect(sent[0]?.provider).toEqual({
      zdr: true,
      data_collection: 'deny',
      require_parameters: true,
      order: ['host-a/us', 'host-b'],
      allow_fallbacks: false,
    });
    expect(sent[0]?.response_format.json_schema.strict).toBe(true);
  });

  it('says when another host answered, the answer was wrong, or the call failed', async () => {
    expect(await check(fake({ provider: 'Host C' }).transport)).toMatchObject({
      status: 'not_pinned',
    });
    expect(await check(fake({ provider: null }).transport)).toMatchObject({
      status: 'not_pinned',
    });
    expect(await check(fake({ content: 'not json' }).transport)).toMatchObject({
      status: 'invalid_output',
    });
    expect(await check(fake({ content: '{"ranked":[]}' }).transport)).toMatchObject({
      status: 'invalid_output',
    });
    expect(await check(fake('timeout').transport)).toMatchObject({ status: 'timed_out' });
    expect(await check(fake(503).transport)).toMatchObject({ status: 'failed', httpStatus: 503 });
  });

  it('never calls a blocked provider, by name or by tag', async () => {
    const { transport, sent } = fake({});
    expect(await check(transport, ['host-a'])).toMatchObject({ status: 'blocked_provider' });
    expect(sent).toHaveLength(0);
  });

  it('matches the host that answered to its pinned tag', () => {
    expect(answeredByPinned('Sail Research', ['sail-research/us'])).toBe(true);
    expect(answeredByPinned('Wafer', ['wafer/us', 'sail-research/us'])).toBe(true);
    expect(answeredByPinned('Wafer', ['sail-research/us'])).toBe(false);
    expect(answeredByPinned(null, ['wafer'])).toBe(false);
  });
});

describe('the key status', () => {
  it('reads the key’s limit and use, and nothing when it cannot', async () => {
    const send = vi.fn(() =>
      Promise.resolve(
        Response.json({ data: { limit: 5, usage: 0.59, limit_remaining: 4.41, label: 'x' } }),
      ),
    );
    expect(await openRouterKeyStatus('k'.repeat(40), send)).toEqual({
      limitUsd: 5,
      usageUsd: 0.59,
      remainingUsd: 4.41,
    });
    const noLimit = () => Promise.resolve(Response.json({ data: { limit: null, usage: 1 } }));
    expect(await openRouterKeyStatus('k'.repeat(40), noLimit)).toEqual({
      limitUsd: null,
      usageUsd: 1,
      remainingUsd: null,
    });
    const refused = () => Promise.resolve(new Response('no', { status: 401 }));
    expect(await openRouterKeyStatus('k'.repeat(40), refused)).toBeNull();
    const down = () => Promise.reject(new TypeError('fetch failed'));
    expect(await openRouterKeyStatus('k'.repeat(40), down)).toBeNull();
  });
});
