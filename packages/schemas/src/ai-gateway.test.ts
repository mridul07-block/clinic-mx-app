import { describe, expect, it } from 'vitest';
import {
  aiCaseSchema,
  aiRankOutputSchema,
  aiTaskConfigSchema,
  microUsdToPaise,
  namesBlockedProvider,
  usdToMicroUsd,
} from './ai-gateway';

// AI-01: what the gateway may send, what it accepts back, its settings and the money it counts.
describe('the AI gateway schemas', () => {
  it('allows only the TAD’s case fields', () => {
    const theCase = {
      age: 34,
      sex: 'female',
      region: 'knee',
      symptoms: ['Pain on stairs'],
      durationWeeks: 6,
      sport: [],
      goal: null,
    };
    expect(aiCaseSchema.parse(theCase)).toEqual(theCase);
    for (const extra of [{ name: 'A' }, { phone: '1' }, { patientId: 'x' }, { dateOfBirth: 'x' }]) {
      expect(aiCaseSchema.safeParse({ ...theCase, ...extra }).success).toBe(false);
    }
  });

  it('blocks a provider by its name, whatever tag pins it', () => {
    const blocked = ['deepseek'];
    for (const pinned of [
      ['deepseek'],
      ['DeepSeek'],
      ['wafer/us', 'deepseek/fp8'],
      [' deepseek/us '],
    ]) {
      expect(namesBlockedProvider(pinned, blocked)).toBe(true);
    }
    for (const pinned of [
      [],
      ['wafer/us'],
      ['sail-research/us'],
      ['deepseekish'],
      ['us/deepseek'],
    ]) {
      expect(namesBlockedProvider(pinned, blocked)).toBe(false);
    }
  });

  it('takes back only numbered rows with a short reason', () => {
    expect(aiRankOutputSchema.safeParse({ ranked: [{ n: 1, reason: 'Stairs' }] }).success).toBe(
      true,
    );
    for (const bad of [
      { ranked: [] },
      { ranked: [{ n: 0, reason: 'x' }] },
      { ranked: [{ n: 1, reason: 'x'.repeat(161) }] },
      { ranked: [{ n: 1, reason: 'x', conditionId: 'KNE-001' }] },
    ]) {
      expect(aiRankOutputSchema.safeParse(bad).success).toBe(false);
    }
  });

  it('configures a task with a model in vendor/model form, or none', () => {
    const config = {
      model: null,
      providers: [],
      promptVersion: 'rank_diagnoses.v1',
      reasoningEffort: 'low',
      timeoutMs: 6000,
      maxTokens: 800,
    };
    expect(aiTaskConfigSchema.parse(config)).toEqual(config);
    expect(aiTaskConfigSchema.safeParse({ ...config, model: 'vendor/model-1.5' }).success).toBe(
      true,
    );
    expect(aiTaskConfigSchema.safeParse({ ...config, model: 'model' }).success).toBe(false);
    expect(aiTaskConfigSchema.safeParse({ ...config, promptVersion: 'v2' }).success).toBe(false);
    expect(aiTaskConfigSchema.safeParse({ ...config, timeoutMs: 60000 }).success).toBe(false);
  });

  it('counts dollars as paise, rounded up, in whole numbers', () => {
    expect(usdToMicroUsd(0.0012)).toBe(1200n);
    expect(usdToMicroUsd(undefined)).toBeNull();
    expect(usdToMicroUsd(-1)).toBeNull();
    expect(microUsdToPaise(1_000_000n, 9650)).toBe(9650n);
    expect(microUsdToPaise(1200n, 9650)).toBe(12n);
    expect(microUsdToPaise(0n, 9650)).toBe(0n);
  });
});
