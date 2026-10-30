import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConditionKnowledge } from '@clinic-mx/schemas';
import type { Db } from '@clinic-mx/db';

const db = vi.hoisted(() => ({
  liveKbVersionId: vi.fn(),
  conditionsWithoutPatientContent: vi.fn(),
  regionPhases: vi.fn(),
  insertAiPatientContentDraft: vi.fn(),
}));
vi.mock('@clinic-mx/db', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  ...db,
}));
const settings: Record<string, unknown> = {};
vi.mock('../settings/settings', () => ({
  getSetting: (key: string) => Promise.resolve(settings[key]),
}));
vi.mock('../access/service', () => ({
  systemService:
    (definition: { run: (tx: unknown, input: unknown) => unknown }) =>
    (_db: unknown, input: unknown) =>
      definition.run({}, input),
}));
const gateway = vi.hoisted(() => ({ writePatientContent: vi.fn() }));
vi.mock('./gateway', () => gateway);

const { generatePatientContent } = await import('./patient-content-generation');

const condition = (n: number): ConditionKnowledge => ({
  conditionId: ['KNE', String(n).padStart(3, '0')].join('-'),
  name: `Test condition ${String(n)}`,
  synonyms: [],
  region: 'knee',
  symptoms: 'Pain on stairs',
  biomechanicalCause: null,
  redFlagText: null,
  details: {},
});
const KB = '00000000-0000-4000-8000-0000000000b1';
const parts = {
  explanation: 'What it is.',
  roadmap: 'What happens next.',
  homeAdvice: 'What to do.',
  warningSigns: 'When to call.',
};
const ok = { status: 'ok', output: parts, runId: 'run' };
const run = (extra: Partial<Parameters<typeof generatePatientContent>[1]> = {}) =>
  generatePatientContent({} as Db, { model: 'vendor/model-1', providers: ['host-a/us'], ...extra });

// AI-07 done when: content generated once per condition; clinician approves before patients see it.
// Generated knowledge base text only; the gateway is mocked (its own tests cover zero data
// retention, pinning and the budget).
describe('writing patient content with AI', () => {
  beforeEach(() => {
    for (const fn of [...Object.values(db), gateway.writePatientContent]) fn.mockReset();
    Object.assign(settings, {
      'ai.task_write_patient_content': {
        model: null,
        providers: [],
        promptVersion: 'write_patient_content.v1',
        reasoningEffort: 'none',
        timeoutMs: 60000,
        maxTokens: 2500,
      },
      'ai.blocked_providers': ['deepseek'],
      'ai.patient_content_stop_after_failures': 3,
    });
    db.liveKbVersionId.mockResolvedValue(KB);
    db.conditionsWithoutPatientContent.mockResolvedValue([1, 2, 3].map(condition));
    db.regionPhases.mockResolvedValue({
      knee: [{ name: 'Phase 1', timing: 'Weeks 0 to 2', goal: 'Settle' }],
    });
    db.insertAiPatientContentDraft.mockImplementation(() => Promise.resolve('draft'));
    gateway.writePatientContent.mockResolvedValue(ok);
  });

  it('drafts each condition without content, from its own words, as the server', async () => {
    expect(await run()).toEqual({
      needed: 3,
      written: 3,
      unavailable: 0,
      skipped: 0,
      capped: false,
      failing: false,
    });
    const [, call] = gateway.writePatientContent.mock.calls[0] as [
      unknown,
      Record<string, unknown>,
    ];
    expect(call).toMatchObject({
      kbVersionId: KB,
      config: { model: 'vendor/model-1', providers: ['host-a/us'], maxTokens: 2500 },
      input: {
        condition: { name: 'Test condition 1', region: 'Knee' },
        phases: [{ name: 'Phase 1' }],
      },
    });
    // Against the version its text was read from. The knowledge base gives no corrections,
    // management or loading stage, nor red flags or referral trigger, so home advice and warning
    // signs are the hand-off line, never the model's words.
    expect(db.insertAiPatientContentDraft).toHaveBeenCalledWith(
      {},
      {
        conditionId: 'KNE-001',
        kbVersionId: KB,
        ...parts,
        homeAdvice: 'Your physiotherapist will go through this with you.',
        warningSigns: 'Your physiotherapist will go through this with you.',
      },
    );
  });

  it('keeps to the conditions and the limit asked for, and refuses one with content', async () => {
    expect(await run({ conditions: ['KNE-002'] })).toMatchObject({ needed: 1, written: 1 });
    expect(await run({ limit: 2 })).toMatchObject({ needed: 3, written: 2 });
    await expect(run({ conditions: ['KNE-009'] })).rejects.toThrow('KNE-009');
  });

  it('never overwrites a draft started meanwhile, and leaves a failed one without content', async () => {
    db.insertAiPatientContentDraft.mockResolvedValueOnce(undefined);
    gateway.writePatientContent
      .mockResolvedValueOnce(ok)
      .mockResolvedValueOnce({ status: 'unavailable', reason: 'invalid_output', runId: 'run' });
    expect(await run()).toMatchObject({ written: 1, skipped: 1, unavailable: 1 });
    expect(db.insertAiPatientContentDraft).toHaveBeenCalledTimes(2);
  });

  it('stops after too many calls in a row with no valid answer', async () => {
    const failed = { status: 'unavailable', reason: 'timed_out', runId: 'run' };
    db.conditionsWithoutPatientContent.mockResolvedValue([1, 2, 3, 4, 5].map(condition));
    gateway.writePatientContent
      .mockResolvedValueOnce(failed)
      .mockResolvedValueOnce(ok)
      .mockResolvedValueOnce(failed)
      .mockResolvedValueOnce(failed);
    settings['ai.patient_content_stop_after_failures'] = 2;
    // A draft written resets the count: fail, write, fail, fail, stop.
    expect(await run()).toMatchObject({ written: 1, unavailable: 3, failing: true });
    expect(gateway.writePatientContent).toHaveBeenCalledTimes(4);
  });

  it('stops at the budget', async () => {
    gateway.writePatientContent
      .mockResolvedValueOnce(ok)
      .mockResolvedValueOnce({ status: 'unavailable', reason: 'capped', runId: 'run' });
    expect(await run()).toMatchObject({ written: 1, capped: true });
    expect(gateway.writePatientContent).toHaveBeenCalledTimes(2);
  });

  it('calls nothing in a dry run, nor for a blocked host, nor without a host or a key', async () => {
    expect(await run({ dryRun: true })).toMatchObject({ needed: 3, written: 3 });
    await expect(run({ providers: ['DeepSeek/fp8'] })).rejects.toThrow('blocked provider');
    await expect(run({ providers: [] })).rejects.toThrow('one to three hosts');
    db.liveKbVersionId.mockResolvedValue(undefined);
    await expect(run()).rejects.toThrow('No knowledge base');
    expect(gateway.writePatientContent).not.toHaveBeenCalled();
    db.liveKbVersionId.mockResolvedValue(KB);
    gateway.writePatientContent.mockResolvedValue({
      status: 'unavailable',
      reason: 'not_configured',
      runId: 'run',
    });
    await expect(run()).rejects.toThrow('OPENROUTER_API_KEY');
  });
});
