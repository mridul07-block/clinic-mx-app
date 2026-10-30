import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  assignLabels,
  blindTestCandidateFileSchema,
  blindTestCaseFileSchema,
  blindTestMetrics,
  blindTestReport,
  fromCsv,
  seededRandom,
  type BlindTestCase,
  type BlindTestOutput,
} from './blind-test';
import { namesBlockedProvider } from './ai-gateway';
import { toCsv } from './finance';

// AI-06 done when: runs 30 to 50 anonymised cases through candidate models; clinicians score
// blind; results compared. Generated cases only (rule 12).
const fakeCase = (n: number, confirmed = ['KNE-001']): BlindTestCase => ({
  ref: ['case', String(n).padStart(3, '0')].join('-'),
  case: {
    age: 30,
    sex: 'female',
    region: 'knee',
    symptoms: [`Fake symptom ${String(n)}`],
    durationWeeks: 4,
    sport: [],
    goal: null,
  },
  onset: 'gradual',
  painZones: [],
  confirmed,
});
const candidate = (id: string, providers = ['provider-a']) => ({
  id,
  config: {
    model: `vendor/${id}`,
    providers,
    promptVersion: 'rank_diagnoses.v1',
    reasoningEffort: 'low',
    timeoutMs: 6000,
    maxTokens: 800,
  },
});

describe('the blind test files', () => {
  it('takes anonymised cases with the confirmed diagnosis, and nothing else', () => {
    expect(blindTestCaseFileSchema.safeParse({ cases: [fakeCase(1), fakeCase(2)] }).success).toBe(
      true,
    );
    const named = { ...fakeCase(1), case: { ...fakeCase(1).case, name: 'Fake Name' } };
    for (const bad of [
      { cases: [named] },
      { cases: [{ ...fakeCase(1), ref: 'patient-42' }] },
      { cases: [fakeCase(1), fakeCase(1)] },
      { cases: [{ ...fakeCase(1), confirmed: [] }] },
      { cases: [{ ...fakeCase(1), confirmed: ['knee 1'] }] },
      { cases: [{ ...fakeCase(1), phone: '1' }] },
    ]) {
      expect(blindTestCaseFileSchema.safeParse(bad).success).toBe(false);
    }
  });

  it('takes 2 to 5 candidates, each with a model and pinned providers', () => {
    expect(
      blindTestCandidateFileSchema.safeParse({ candidates: [candidate('a'), candidate('b')] })
        .success,
    ).toBe(true);
    for (const bad of [
      { candidates: [candidate('a')] },
      { candidates: [candidate('a'), candidate('a')] },
      { candidates: [candidate('a'), candidate('b', [])] },
      {
        candidates: [
          candidate('a'),
          { ...candidate('b'), config: { ...candidate('b').config, model: null } },
        ],
      },
    ]) {
      expect(blindTestCandidateFileSchema.safeParse(bad).success).toBe(false);
    }
  });

  it('accepts the recommended candidate file, with reasoning off and no blocked host', () => {
    const text = readFileSync(
      join(
        import.meta.dirname,
        '..',
        '..',
        '..',
        'docs',
        'examples',
        'blind-test-candidates.example.json',
      ),
      'utf8',
    );
    const file = JSON.parse(text) as unknown;
    for (const { config } of blindTestCandidateFileSchema.parse(file).candidates) {
      expect(config.reasoningEffort).toBe('none');
      expect(namesBlockedProvider(config.providers, ['deepseek'])).toBe(false);
    }
  });
});

describe('blind scoring', () => {
  it('hides each candidate behind a label shuffled per case, rebuilt from its seed', () => {
    const refs = Array.from({ length: 20 }, (_, i) =>
      ['case', String(i + 1).padStart(3, '0')].join('-'),
    );
    const labels = assignLabels(refs, ['a', 'b', 'c'], seededRandom(42));
    for (const ref of refs) {
      expect(Object.keys(labels[ref] ?? {})).toEqual(['A', 'B', 'C']);
      expect(Object.values(labels[ref] ?? {}).sort()).toEqual(['a', 'b', 'c']);
    }
    expect(new Set(refs.map((ref) => labels[ref]?.A)).size).toBeGreaterThan(1);
    expect(assignLabels(refs, ['a', 'b', 'c'], seededRandom(42))).toEqual(labels);
  });

  it('reads back the CSV it writes, quotes and line breaks included', () => {
    const rows = [
      ['case', 'suggestions'],
      ['case-001', '1. Fake, condition: "reason"\n2. Other'],
    ];
    const [header, ...body] = rows;
    expect(fromCsv(toCsv(header ?? [], body))).toEqual(rows);
  });
});

describe('the comparison', () => {
  const output = (
    ref: string,
    candidate: string,
    ranked: string[],
    extra: Partial<BlindTestOutput> = {},
  ): BlindTestOutput => ({
    ref,
    candidate,
    status: 'ok',
    suggestions: ranked.map((conditionId, i) => ({
      conditionId,
      region: 'knee',
      rowNumber: i + 1,
      rank: i + 1,
      section: i < 3 ? 'top' : 'also_consider',
      reason: 'Fake reason',
    })),
    onShortlist: true,
    latencyMs: 1000 * (ranked.length + 1),
    costPaise: 3,
    ...extra,
  });

  it('counts the confirmed diagnosis in the top 1, top 3 and on the sheet, per candidate', () => {
    const cases = [fakeCase(1), fakeCase(2), fakeCase(3), fakeCase(4, ['KNE-009'])];
    const outputs = [
      output('case-001', 'a', ['KNE-001', 'KNE-002']),
      output('case-002', 'a', ['KNE-002', 'KNE-003', 'KNE-001']),
      output('case-003', 'a', ['KNE-002', 'KNE-003', 'KNE-004', 'KNE-001']),
      output('case-004', 'a', [], { status: 'timed_out', onShortlist: false, costPaise: null }),
      output('case-001', 'b', ['KNE-002']),
      output('case-002', 'b', ['KNE-001']),
      output('case-003', 'b', ['KNE-001']),
      output('case-004', 'b', ['KNE-009'], { onShortlist: false }),
    ];
    const scores = [
      { ref: 'case-001', label: 'A', usefulness: 4, unsafe: false, scorer: 's1', candidate: 'a' },
      { ref: 'case-001', label: 'B', usefulness: 2, unsafe: true, scorer: 's1', candidate: 'b' },
    ];
    const metrics = blindTestMetrics({ cases, outputs, scores, top: 3 });
    const [a, b] = metrics.candidates;
    expect(a).toMatchObject({
      candidate: 'a',
      runs: 4,
      statuses: { ok: 3, timed_out: 1 },
      unavailableRate: 0.25,
      top1: 0.25,
      topN: 0.5,
      topAll: 0.75,
      misses: ['case-004'],
      costPaise: 9,
      costReported: 0.75,
      meanUsefulness: 4,
      unsafe: [],
    });
    expect(b).toMatchObject({ top1: 0.75, topN: 0.75, misses: ['case-001'], unsafe: ['case-001'] });
    expect(metrics.shortlistCeiling).toBe(0.75);
    const report = blindTestReport(metrics, {
      runId: 'run-1',
      kbVersionNumber: 1,
      promptVersion: 'rank_diagnoses.v1',
      cases: 4,
      top: 3,
    });
    expect(report).toContain('| a | 25% | 50% | 75% | 25% |');
    expect(report).toContain('Whether the blind test passed is the clinicians’ decision');
    // No verdict of its own: the only mention is the clinicians' decision.
    expect(report.replace('Whether the blind test passed', '')).not.toMatch(/\b(pass|fail)/i);
  });
});
