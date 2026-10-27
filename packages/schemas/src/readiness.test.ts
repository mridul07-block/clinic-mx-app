import { describe, expect, it } from 'vitest';
import type { KnowledgeMeasure } from './objective';
import {
  clearanceBlockers,
  clearanceRefusal,
  measuredResult,
  readinessOverrideSchema,
  readinessReadingSchema,
} from './readiness';

const measure = (extra: Partial<KnowledgeMeasure>): KnowledgeMeasure => ({
  key: 'knee.lsi.quadriceps', // gitleaks:allow
  region: 'knee',
  section: 'STRENGTH — LIMB SYMMETRY INDEX (target >=90%)',
  name: 'Quadriceps',
  unit: 'kg',
  kind: 'lsi',
  inverted: false,
  rule: { kind: 'lsi', passAt: 0.9 },
  direction: null,
  note: null,
  ...extra,
});
const lsi = measure({});
const range = measure({
  key: 'shoulder.deficit.passive_elevation', // gitleaks:allow
  kind: 'deficit',
  unit: 'deg',
  rule: { kind: 'deficit', absolute: false, okAt: 5, mildAt: 15, okWord: 'symmetrical' },
});
const marker = measure({
  key: 'lumbar_sij.marker.sitting_tolerance', // gitleaks:allow
  kind: 'marker',
  unit: 'min',
  rule: { kind: 'none' },
});
const own = { rule: { kind: 'measure' as const } };

// OUT-08 done when: Met, Not met, Not assessed per criterion; clearance disabled while anything is
// Not assessed; three statuses; override with reason (user decisions 27 October 2026).
describe('readiness', () => {
  it('judges a measured criterion by the workbook’s rule, Not assessed without a reading', () => {
    expect(measuredResult(own, lsi, { involved: 38, uninvolved: 40 }, undefined)).toBe('met');
    expect(measuredResult(own, lsi, { involved: 32, uninvolved: 40 }, undefined)).toBe('not_met');
    expect(measuredResult(own, lsi, undefined, undefined)).toBe('not_assessed');
    expect(measuredResult(own, range, { involved: 160, uninvolved: 175 }, undefined), 'mild').toBe(
      'met',
    );
    expect(measuredResult(own, range, { involved: 150, uninvolved: 175 }, undefined)).toBe(
      'not_met',
    );
  });

  it('judges a target from the newest reading and an MCID from the first', () => {
    const target = { rule: { kind: 'target' as const, target: 60 } };
    expect(measuredResult(target, marker, { value: 60 }, undefined)).toBe('met');
    expect(measuredResult(target, marker, { value: 40 }, undefined)).toBe('not_met');
    const lower = { rule: { kind: 'mcid' as const, mcid: 10, better: 'lower' as const } };
    const first = { value: 48 };
    expect(measuredResult(lower, marker, { value: 30 }, first)).toBe('met');
    expect(measuredResult(lower, marker, { value: 44 }, first)).toBe('not_met');
    expect(measuredResult(lower, marker, first, first), 'one reading only').toBe('not_assessed');
    const higher = { rule: { kind: 'mcid' as const, mcid: 2, better: 'higher' as const } };
    expect(measuredResult(higher, marker, { value: 6 }, { value: 3 })).toBe('met');
  });

  it('blocks a clearance in the Frontend Specification’s words until each is Met or overridden', () => {
    expect(
      clearanceBlockers([
        { result: 'not_assessed', override: null },
        { result: 'not_assessed', override: null },
        { result: 'not_met', override: null },
        { result: 'not_met', override: 'Agreed with the surgeon.' },
        { result: 'met', override: null },
      ]),
    ).toEqual([
      '2 tests not assessed. Record them or add an override reason.',
      '1 test not met. Add an override reason.',
    ]);
    expect(clearanceBlockers([{ result: 'not_assessed', override: null }])).toEqual([
      '1 test not assessed. Record it or add an override reason.',
    ]);
    expect(clearanceBlockers([{ result: 'not_met', override: 'Agreed.' }])).toEqual([]);
  });

  it('signs the three statuses in order, once each', () => {
    const clear = [{ result: 'met' as const, override: null }];
    expect(clearanceRefusal('rehabilitation_complete', [], clear)).toBeUndefined();
    expect(clearanceRefusal('return_to_training', [], clear)).toBe(
      'Sign Rehabilitation complete first.',
    );
    expect(clearanceRefusal('return_to_sport', ['rehabilitation_complete'], clear)).toBe(
      'Sign Return to training first.',
    );
    expect(clearanceRefusal('rehabilitation_complete', ['rehabilitation_complete'], clear)).toBe(
      'Rehabilitation complete is signed already.',
    );
    expect(
      clearanceRefusal('rehabilitation_complete', [], [{ result: 'not_met', override: null }]),
    ).toBe('1 test not met. Add an override reason.');
  });

  it('takes an override’s written reason and a panel reading', () => {
    const episodeId = '00000000-0000-4000-8000-000000000501';
    const criterionKey = 'knee.lsi.hamstrings'; // gitleaks:allow
    expect(
      readinessOverrideSchema.parse({ episodeId, criterionKey, reason: '  Agreed.  ' }).reason,
    ).toBe('Agreed.');
    expect(
      readinessOverrideSchema.safeParse({ episodeId, criterionKey, reason: ' ' }).success,
    ).toBe(false);
    expect(readinessReadingSchema.parse({ episodeId, criterionKey, involved: 36 })).toEqual({
      episodeId,
      criterionKey,
      involved: 36,
      uninvolved: null,
      value: null,
    });
    expect(
      readinessReadingSchema.safeParse({ episodeId, criterionKey, value: Number.NaN }).success,
    ).toBe(false);
  });
});
