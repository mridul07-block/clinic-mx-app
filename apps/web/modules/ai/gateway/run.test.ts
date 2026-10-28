import type { Db } from '@clinic-mx/db';
import type { AiRankInput, AiTaskConfig } from '@clinic-mx/schemas';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { z } from 'zod';
import { rankDiagnoses, rankForBlindTest, recheckWithFindings } from './index';
import { PROMPTS } from './prompts';
import { buildRequest, runTask } from './run';
import type { AiRequest, AiTransport, AiTransportResult } from './transport';

const db = vi.hoisted(() => ({
  insertAiRun: vi.fn(),
  aiSpendSince: vi.fn(),
  blindTestSpend: vi.fn(),
  openAiSpendCapTask: vi.fn(),
}));
vi.mock('@clinic-mx/db', () => db);
vi.mock('../../access/service', () => ({
  systemService:
    (definition: { input: z.ZodType; run: (tx: unknown, input: unknown) => unknown }) =>
    (_db: unknown, input: unknown) =>
      definition.run({ kind: 'transaction' }, definition.input.parse(input)),
}));
const settings = vi.hoisted((): Record<string, unknown> => ({}));
vi.mock('../../settings/settings', () => ({
  getSetting: (key: string) => Promise.resolve(settings[key]),
}));
vi.mock('./transport', () => ({ defaultTransport: () => null }));

const config: AiTaskConfig & { model: string } = {
  model: 'vendor/model-1',
  providers: ['provider-a'],
  promptVersion: 'rank_diagnoses.v1',
  reasoningEffort: 'low',
  timeoutMs: 6000,
  maxTokens: 800,
};
const kbVersionId = '00000000-0000-4000-8000-000000000c01';
const episodeId = '00000000-0000-4000-8000-000000000e01';
const pass = { kbVersionId } as Parameters<typeof rankDiagnoses>[1];
const theCase = {
  age: 34,
  sex: 'female' as const,
  region: 'knee' as const,
  symptoms: ['Pain on stairs'],
  durationWeeks: 6,
  sport: ['running'],
  goal: 'Run a 10 km race',
};
const rows = [
  {
    conditionId: 'KNE-001',
    name: 'Patellofemoral pain',
    mustRuleOut: false,
    age: '15-40',
    onset: 'Slow',
    sex: 'Female',
    symptoms: 'Anterior knee pain on stairs',
  },
  {
    conditionId: 'KNE-002',
    name: 'Fracture',
    mustRuleOut: true,
    age: 'Any',
    onset: 'Sudden',
    sex: 'Equal',
    symptoms: null,
  },
];
const rankInput: AiRankInput = {
  case: theCase,
  rows: rows.map(({ conditionId: _id, ...row }, i) => ({ n: i + 1, ...row })),
};
const answer = (content: unknown, extra: Partial<AiTransportResult> = {}): AiTransportResult =>
  ({
    ok: true,
    content: typeof content === 'string' ? content : JSON.stringify(content),
    model: 'vendor/model-1',
    provider: 'provider-a',
    costMicroUsd: 1200n,
    tokensIn: 900,
    tokensOut: 60,
    ...extra,
  }) as AiTransportResult;
const valid = {
  ranked: [
    { n: 2, reason: 'Sudden onset' },
    { n: 1, reason: 'Stairs' },
  ],
};
function fake(...results: AiTransportResult[]) {
  const sent: AiRequest[] = [];
  const transport: AiTransport = {
    complete: vi.fn((request: AiRequest) => {
      sent.push(request);
      return Promise.resolve(results.shift() ?? answer(valid));
    }),
  };
  return { transport, sent };
}
const run = (transport: AiTransport | null, input: unknown = rankInput, forbidden?: string[]) =>
  runTask({} as Db, 'rank_diagnoses', input, { episodeId, kbVersionId, transport, forbidden });
const recorded = () => db.insertAiRun.mock.calls.map(([, row]) => row as Record<string, unknown>);

// AI-01 done when: OpenRouter with zdr on every request, pinned provider, schema output, retry
// once, logging to ai_run, daily spend cap. No key exists, so these use a fake transport.
describe('the AI gateway', () => {
  beforeEach(() => {
    for (const fn of Object.values(db)) fn.mockReset();
    db.insertAiRun.mockResolvedValue('00000000-0000-4000-8000-000000000a01');
    db.aiSpendSince.mockResolvedValue(0n);
    Object.assign(settings, {
      'ai.task_rank_diagnoses': config,
      'ai.task_recheck_with_findings': { ...config, promptVersion: 'recheck_with_findings.v1' },
      'ai.daily_spend_cap_paise': 20000,
      'ai.usd_rate_paise': 9650,
      'ai.blocked_providers': ['deepseek'],
      'ai.blind_test_budget_paise': 200000,
    });
  });

  it('asks for zero data retention, no data collection and the pinned providers every time', async () => {
    const { transport, sent } = fake(answer('not json'), answer(valid));
    expect((await run(transport)).status).toBe('ok');
    expect(sent).toHaveLength(2);
    for (const request of sent) {
      expect(request.provider).toEqual({
        zdr: true,
        data_collection: 'deny',
        require_parameters: true,
        order: ['provider-a'],
        allow_fallbacks: false,
      });
      expect(request.model).toBe('vendor/model-1');
      expect(request.messages).toEqual([
        { role: 'system', content: PROMPTS['rank_diagnoses.v1'] },
        { role: 'user', content: expect.any(String) as string },
      ]);
      expect(request.response_format).toEqual({
        type: 'json_schema',
        json_schema: {
          name: 'rank_diagnoses',
          strict: true,
          schema: {
            type: 'object',
            properties: {
              ranked: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: { n: { type: 'integer' }, reason: { type: 'string' } },
                  required: ['n', 'reason'],
                  additionalProperties: false,
                },
              },
            },
            required: ['ranked'],
            additionalProperties: false,
          },
        },
      });
      expect(request.max_tokens).toBe(800);
      expect(request.reasoning).toEqual({ effort: 'low' });
      expect(JSON.stringify(request)).not.toContain('"user":');
    }
  });

  it('sends no reasoning effort when it is none, and still zero data retention', () => {
    const request = buildRequest('rank_diagnoses', { ...config, reasoningEffort: 'none' }, '{}');
    expect(request.reasoning).toBeUndefined();
    expect(request.provider.zdr).toBe(true);
  });

  it('retries an invalid answer once, then is unavailable without throwing', async () => {
    const { transport, sent } = fake(answer('{"ranked": []}'), answer({ ranked: 'x' }));
    expect(await run(transport)).toMatchObject({
      status: 'unavailable',
      reason: 'invalid_output',
    });
    expect(sent).toHaveLength(2);
    expect(recorded()).toEqual([
      expect.objectContaining({
        status: 'invalid_output',
        attempts: 2,
        output: null,
        costMicroUsd: 2400n,
      }),
    ]);
  });

  it('retries a timeout or a provider error once', async () => {
    const timedOut = fake({ ok: false, failure: 'timeout' }, { ok: false, failure: 'timeout' });
    expect(await run(timedOut.transport)).toMatchObject({ reason: 'timed_out' });
    expect(timedOut.sent).toHaveLength(2);
    const recovered = fake({ ok: false, failure: 'http', httpStatus: 503 }, answer(valid));
    expect((await run(recovered.transport)).status).toBe('ok');
    expect(recorded().at(-1)).toMatchObject({ status: 'ok', attempts: 2, costMicroUsd: 1200n });
  });

  it('logs every run with the input sent, its hash and the knowledge base version', async () => {
    const { transport } = fake();
    const result = await run(transport);
    expect(result).toEqual({
      status: 'ok',
      output: valid,
      runId: '00000000-0000-4000-8000-000000000a01',
    });
    const [row] = recorded();
    expect(row).toMatchObject({
      kind: 'rank_diagnoses',
      episodeId,
      kbVersionId,
      model: 'vendor/model-1',
      provider: 'provider-a',
      promptVersion: 'rank_diagnoses.v1',
      input: rankInput,
      output: valid,
      status: 'ok',
      attempts: 1,
      costMicroUsd: 1200n,
      tokensIn: 900,
      tokensOut: 60,
    });
    expect(row?.inputHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('calls nothing past the daily spend cap, and tells the Super Admin', async () => {
    // 2,072,538 millionths of a dollar at 96.50 rupees is 19,999.99 paise, rounded up: 200 rupees.
    db.aiSpendSince.mockResolvedValue(2_072_538n);
    const { transport, sent } = fake();
    expect(await run(transport)).toMatchObject({ reason: 'capped' });
    expect(sent).toHaveLength(0);
    expect(db.openAiSpendCapTask).toHaveBeenCalledWith(
      { kind: 'transaction' },
      expect.objectContaining({ capPaise: 20000, spentPaise: '20000' }),
    );
    expect(recorded()).toEqual([
      expect.objectContaining({ status: 'capped', attempts: 0, input: {} }),
    ]);
    db.aiSpendSince.mockResolvedValue(2_072_000n);
    expect((await run(transport)).status).toBe('ok');
  });

  it('calls nothing without a key, a model or pinned providers', async () => {
    expect(await run(null)).toMatchObject({ reason: 'not_configured' });
    settings['ai.task_rank_diagnoses'] = { ...config, model: null };
    const { transport, sent } = fake();
    expect(await run(transport)).toMatchObject({ reason: 'not_configured' });
    settings['ai.task_rank_diagnoses'] = { ...config, providers: [] };
    expect(await run(transport)).toMatchObject({ reason: 'not_configured' });
    expect(sent).toHaveLength(0);
    expect(recorded().map((r) => r.status)).toEqual([
      'not_configured',
      'not_configured',
      'not_configured',
    ]);
  });

  it('sends nothing that names or numbers the patient', async () => {
    const { transport, sent } = fake();
    const withCase = (extra: object) => ({ ...rankInput, case: { ...theCase, ...extra } });
    expect(await run(transport, withCase({ name: 'Asha' }))).toMatchObject({ reason: 'blocked' });
    for (const symptom of [
      'Call me on 98765\n43210',
      'Seen as\nHSR-00042',
      'Call me on 98765 43210',
      'asha@example.com',
      'Seen as HSR-00042',
      'Patient 3f1c2a9e-1b2c-4d3e-8f90-123456789abc',
    ]) {
      expect(await run(transport, withCase({ symptoms: [symptom] }))).toMatchObject({
        reason: 'blocked',
      });
    }
    expect(await run(transport, rankInput, ['Asha Rao'])).toMatchObject({ status: 'ok' });
    expect(
      await run(transport, withCase({ goal: 'Dance at Asha’s wedding' }), ['Asha Rao']),
    ).toMatchObject({ reason: 'blocked' });
    expect(sent).toHaveLength(1);
    expect(
      await run(transport, withCase({ symptoms: ['Pain since\nAsha’s fall'] }), ['Asha Rao']),
    ).toMatchObject({ reason: 'blocked' });
    for (const row of recorded().filter((r) => r.status === 'blocked')) {
      expect(row.input).toEqual({});
    }
  });
});

describe('the clinical tasks', () => {
  beforeEach(() => {
    for (const fn of Object.values(db)) fn.mockReset();
    db.insertAiRun.mockResolvedValue('00000000-0000-4000-8000-000000000a01');
    db.aiSpendSince.mockResolvedValue(0n);
  });

  it('send the shortlist numbered and return condition IDs, on the pass’s version', async () => {
    const { transport, sent } = fake(
      answer({ ranked: [...valid.ranked, { n: 9, reason: 'Not on the list' }] }),
    );
    const result = await rankDiagnoses({} as Db, pass, {
      case: theCase,
      rows,
      episodeId,
      transport,
    });
    expect(result).toMatchObject({
      status: 'ok',
      output: [
        { conditionId: 'KNE-002', reason: 'Sudden onset' },
        { conditionId: 'KNE-001', reason: 'Stairs' },
      ],
    });
    expect(sent[0]?.messages[1]?.content).not.toContain('KNE-');
    expect(recorded()[0]).toMatchObject({ kbVersionId, episodeId });
  });

  it('recheck sends the findings with its own prompt', async () => {
    const { transport, sent } = fake();
    const result = await recheckWithFindings({} as Db, pass, {
      case: theCase,
      rows,
      episodeId,
      findings: ['Positive patellar grind'],
      transport,
    });
    expect(result.status).toBe('ok');
    expect(sent[0]?.messages[0]?.content).toBe(PROMPTS['recheck_with_findings.v1']);
    expect(sent[0]?.messages[1]?.content).toContain('Positive patellar grind');
  });
  // AI-05: similar confirmed cases go only to a prompt that is told about them.
  it('sends similar cases only with a v2 prompt, and logs what it sent', async () => {
    const similar = [
      {
        age: 31,
        sex: 'female' as const,
        region: 'knee' as const,
        symptoms: ['Front of knee'],
        durationWeeks: 8,
        sport: ['Running'],
        confirmed: 'Patellar tendinopathy',
        n: null,
      },
    ];
    const v1 = fake();
    await rankDiagnoses({} as Db, pass, {
      case: theCase,
      rows,
      similar,
      episodeId,
      transport: v1.transport,
    });
    expect(v1.sent[0]?.messages[1]?.content).not.toContain('Patellar tendinopathy');
    expect(recorded()[0]?.input).not.toHaveProperty('similar');

    settings['ai.task_rank_diagnoses'] = { ...config, promptVersion: 'rank_diagnoses.v2' };
    const v2 = fake();
    await rankDiagnoses({} as Db, pass, {
      case: theCase,
      rows,
      similar,
      episodeId,
      transport: v2.transport,
    });
    expect(v2.sent[0]?.messages[0]?.content).toBe(PROMPTS['rank_diagnoses.v2']);
    expect(v2.sent[0]?.messages[1]?.content).toContain('Patellar tendinopathy');
    expect(recorded()[1]).toMatchObject({ promptVersion: 'rank_diagnoses.v2' });
    expect(recorded()[1]?.input).toHaveProperty('similar');

    // A similar case carrying anything but its structured fields is refused, not sent.
    const v2b = fake();
    const refused = await rankDiagnoses({} as Db, pass, {
      case: theCase,
      rows,
      similar: [{ ...similar[0], episodeId } as unknown as (typeof similar)[number]],
      episodeId,
      transport: v2b.transport,
    });
    expect(refused).toMatchObject({ status: 'unavailable', reason: 'blocked' });
    expect(v2b.sent).toHaveLength(0);
  });
});

// AI-06: a blind test runs a candidate's model for one call, never the task's settings, with its
// own budget, and keeps every privacy rule of a live run.
describe('the blind test', () => {
  const runId = '00000000-0000-4000-8000-000000000b01';
  const candidate = { ...config, model: 'vendor/candidate-b', providers: ['provider-b'] };
  const blind = (transport: AiTransport, extra: Partial<typeof candidate> = {}) =>
    rankForBlindTest({} as Db, {
      runId,
      kbVersionId,
      case: theCase,
      rows,
      config: { ...candidate, ...extra },
      transport,
    });

  beforeEach(() => {
    for (const fn of Object.values(db)) fn.mockReset();
    db.insertAiRun.mockResolvedValue('00000000-0000-4000-8000-000000000a01');
    db.aiSpendSince.mockResolvedValue(0n);
    db.blindTestSpend.mockResolvedValue(0n);
    // The task itself has no model: the blind test never reads it.
    settings['ai.task_rank_diagnoses'] = { ...config, model: null, providers: [] };
  });

  it('runs the candidate’s model, pinned, with zero data retention, tagged', async () => {
    const { transport, sent } = fake();
    expect((await blind(transport)).status).toBe('ok');
    expect(sent[0]).toMatchObject({
      model: 'vendor/candidate-b',
      provider: {
        zdr: true,
        data_collection: 'deny',
        order: ['provider-b'],
        allow_fallbacks: false,
      },
    });
    expect(recorded()[0]).toMatchObject({
      blindTestRun: runId,
      episodeId: null,
      model: 'vendor/model-1',
    });
  });

  it('counts its own budget, never the daily cap, and tells nobody', async () => {
    db.aiSpendSince.mockResolvedValue(10_000_000n);
    const { transport, sent } = fake();
    expect((await blind(transport)).status).toBe('ok');
    // 20,725,389 millionths of a dollar at 96.50 rupees is just past 2,000 rupees.
    db.blindTestSpend.mockResolvedValue(20_725_389n);
    expect(await blind(transport)).toMatchObject({ reason: 'capped' });
    expect(sent).toHaveLength(1);
    expect(db.openAiSpendCapTask).not.toHaveBeenCalled();
  });

  it('never routes to a blocked provider, live or blind', async () => {
    const { transport, sent } = fake();
    expect(await blind(transport, { providers: ['DeepSeek'] })).toMatchObject({
      reason: 'not_configured',
    });
    settings['ai.task_rank_diagnoses'] = { ...config, providers: ['deepseek'] };
    expect(await run(transport)).toMatchObject({ reason: 'not_configured' });
    expect(sent).toHaveLength(0);
  });

  it('keeps the identifier guard, and refuses an episode', async () => {
    const { transport, sent } = fake();
    const named = await rankForBlindTest({} as Db, {
      runId,
      kbVersionId,
      case: { ...theCase, symptoms: ['Call 98765 43210'] },
      rows,
      config: candidate,
      transport,
    });
    expect(named).toMatchObject({ reason: 'blocked' });
    await expect(
      runTask({} as Db, 'rank_diagnoses', rankInput, {
        episodeId,
        kbVersionId,
        blindTest: { runId, config: candidate },
        transport,
      }),
    ).rejects.toThrow('outside any episode');
    expect(sent).toHaveLength(0);
  });
});
