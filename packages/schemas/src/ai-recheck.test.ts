import { describe, expect, it } from 'vitest';
import { aiRecheckInputSchema } from './ai-gateway';
import { recheckFindings } from './ai-recheck';
import type { KnowledgeMeasure, KnowledgeSpecialTest } from './objective';

// AI-04: what a recheck sends of the examination, in the knowledge base's words, never the
// clinician's free text.
const measure = (
  key: string,
  name: string,
  rule: KnowledgeMeasure['rule'],
  unit = 'kg',
): KnowledgeMeasure => ({
  key,
  region: 'knee',
  section: 'Strength',
  name,
  unit,
  kind: rule.kind === 'lsi' ? 'lsi' : rule.kind === 'deficit' ? 'deficit' : 'reference',
  inverted: false,
  rule,
  direction: null,
  note: null,
});
const test = (key: string, name: string): KnowledgeSpecialTest => ({
  key,
  region: 'knee',
  category: 'Ligament',
  test: name,
  targets: '',
  positiveFinding: '',
  clinicalNote: '',
});
const catalog = {
  measures: [
    measure('knee.quad', 'Quadriceps strength', { kind: 'lsi', passAt: 0.9 }),
    measure(
      'knee.flexion',
      'Knee flexion',
      { kind: 'deficit', okAt: 5, mildAt: 15, okWord: 'full', absolute: false },
      '°',
    ),
    measure(
      'knee.hop',
      'Single hop',
      { kind: 'reference_target', reference: 100, passWhen: 'at_least' },
      'cm',
    ),
    measure('knee.grade', 'Effusion grade', { kind: 'none' }, ''),
  ],
  specialTests: [test('knee.lachman', 'Lachman test'), test('knee.mcmurray', 'McMurray test')],
};

describe('the findings a recheck sends', () => {
  it('names tests and measures as the knowledge base does, positive and not passed first', () => {
    expect(
      recheckFindings(
        {
          measures: {
            'knee.quad': { involved: 40, uninvolved: 50 },
            'knee.flexion': { involved: 120, uninvolved: 122 },
            'knee.hop': { value: 120 },
            'knee.grade': { value: 2 },
            'knee.unknown': { value: 1 },
          },
          tests: [
            { key: 'knee.mcmurray', result: 'negative', interpretation: '' },
            { key: 'knee.lachman', result: 'positive', interpretation: 'Seen by Fake Name' },
            { key: 'knee.pivot', result: 'positive', interpretation: '' },
          ],
        },
        catalog,
      ),
    ).toEqual([
      'Lachman test: Positive',
      'Quadriceps strength: LSI 80% (Not yet)',
      'McMurray test: Negative',
      'Knee flexion: deficit 2 ° (Full)',
      'Single hop: 120 cm (Pass)',
      'Effusion grade: 2',
    ]);
  });

  it('leaves out tests not done, unread measures and every word the clinician typed', () => {
    const sent = recheckFindings(
      {
        measures: { 'knee.quad': { involved: 40 } },
        tests: [
          { key: 'knee.lachman', result: 'not_tested', interpretation: 'Fake Name' },
          { key: 'knee.mcmurray', interpretation: 'Fake Name' },
        ],
      },
      catalog,
    );
    expect(sent).toEqual([]);
  });

  it('stays within what the gateway accepts', () => {
    const many = Array.from({ length: 60 }, (_, i) =>
      test(`knee.t${String(i)}`, `${'Long test name '.repeat(20)}${String(i)}`),
    );
    const sent = recheckFindings(
      {
        measures: {},
        tests: many.map((t) => ({ key: t.key, result: 'positive' as const, interpretation: '' })),
      },
      { measures: [], specialTests: many },
    );
    expect(sent).toHaveLength(40);
    expect(sent.every((line) => line.length <= 200)).toBe(true);
    expect(aiRecheckInputSchema.shape.findings.safeParse(sent).success).toBe(true);
  });
});
