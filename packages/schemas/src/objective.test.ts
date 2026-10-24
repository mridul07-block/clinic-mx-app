import { describe, expect, it } from 'vitest';
import { confirmedCount, consultationSectionsSchema } from './consultations';
import { lsiPercent, measureResult, type KnowledgeMeasure, type MeasureRule } from './objective';

const measure = (rule: MeasureRule, extra: Partial<KnowledgeMeasure> = {}): KnowledgeMeasure => ({
  key: 'knee.lsi.quadriceps',
  region: 'knee',
  section: 'STRENGTH — LIMB SYMMETRY INDEX (target >=90%)',
  name: 'Quadriceps',
  unit: 'kg',
  kind: 'lsi',
  inverted: false,
  rule,
  direction: null,
  note: null,
  ...extra,
});

// CLN-05: the arithmetic of the workbooks' formulas, live as the clinician types.
describe('measure results', () => {
  it('works out the LSI as involved over uninvolved, Pass at the target', () => {
    const quadriceps = measure({ kind: 'lsi', passAt: 0.9 });
    expect(measureResult(quadriceps, { involved: 32, uninvolved: 40 })).toEqual({
      lsi: 0.8,
      status: 'not_yet',
    });
    expect(measureResult(quadriceps, { involved: 36, uninvolved: 40 }).status).toBe('pass');
    expect(lsiPercent(0.8)).toBe('80%');
    expect(measureResult(quadriceps, { involved: 32 })).toEqual({});
    expect(measureResult(quadriceps, { involved: 32, uninvolved: 0 })).toEqual({});
  });

  it('inverts a timed test, and needs the heel raise count as well', () => {
    const hop = measure({ kind: 'lsi', passAt: 0.9 }, { inverted: true, unit: 'sec' });
    const result = measureResult(hop, { involved: 2.4, uninvolved: 2.2 });
    expect(result.lsi).toBeCloseTo(0.9167, 3);
    expect(result.status).toBe('pass');
    const heelRaise = measure({ kind: 'lsi', passAt: 0.9, minInvolved: 25 });
    expect(measureResult(heelRaise, { involved: 24, uninvolved: 25 }).status).toBe('not_yet');
    expect(measureResult(heelRaise, { involved: 25, uninvolved: 26 }).status).toBe('pass');
  });

  it('bands a range deficit as the workbook does', () => {
    const flexion = measure(
      { kind: 'deficit', absolute: true, okAt: 5, mildAt: 15, okWord: 'symmetrical' },
      { kind: 'deficit', unit: 'deg' },
    );
    expect(measureResult(flexion, { involved: 130, uninvolved: 135 })).toEqual({
      deficit: 5,
      status: 'symmetrical',
    });
    expect(measureResult(flexion, { involved: 120, uninvolved: 135 }).status).toBe('mild');
    expect(measureResult(flexion, { involved: 110, uninvolved: 135 }).status).toBe('restricted');
    expect(measureResult(flexion, { involved: 145, uninvolved: 135 }).deficit).toBe(10);
    const elevation = measure(
      { kind: 'deficit', absolute: false, okAt: 5, mildAt: 15, okWord: 'symmetrical' },
      { kind: 'deficit' },
    );
    expect(measureResult(elevation, { involved: 180, uninvolved: 170 })).toEqual({
      deficit: -10,
      status: 'symmetrical',
    });
  });

  it('reads one value against its normal or target', () => {
    const rotation = measure(
      { kind: 'reference_deficit', reference: 80, okAt: 5, mildAt: 20, okWord: 'full' },
      { kind: 'reference' },
    );
    expect(measureResult(rotation, { value: 78 })).toEqual({ deficit: 2, status: 'full' });
    expect(measureResult(rotation, { value: 50 }).status).toBe('restricted');
    const endurance = measure(
      { kind: 'reference_target', reference: 38, passWhen: 'at_least' },
      { kind: 'reference' },
    );
    expect(measureResult(endurance, { value: 40 }).status).toBe('pass');
    const error = measure(
      { kind: 'reference_target', reference: 4.5, passWhen: 'at_most' },
      { kind: 'reference' },
    );
    expect(measureResult(error, { value: 5 }).status).toBe('not_yet');
    expect(measureResult(measure({ kind: 'none' }, { kind: 'grade' }), { value: 2 })).toEqual({});
  });
});

describe('the Objective section', () => {
  it('reads an older draft and counts what was recorded', () => {
    const empty = consultationSectionsSchema.parse({ objective: { notes: 'Earlier' } });
    expect(empty.objective).toEqual({
      notes: 'Earlier',
      region: '',
      side: '',
      measures: {},
      tests: [],
    });
    const sections = consultationSectionsSchema.parse({
      objective: {
        notes: '',
        region: 'knee',
        side: 'right',
        measures: {
          'knee.lsi.quadriceps': { involved: 32, uninvolved: 40 },
          'knee.marker.effusion_grade_0_3': { value: 2 },
          'knee.lsi.hamstrings': {},
        },
        tests: [
          {
            key: 'knee.lachman_20_30_degrees_flexion',
            result: 'positive',
            interpretation: 'Soft end-feel',
          },
        ],
      },
    });
    expect(confirmedCount(sections, 'objective')).toBe(3);
  });

  it('refuses bad keys, readings, a test twice and a long interpretation', () => {
    const refused = (objective: unknown) =>
      !consultationSectionsSchema.safeParse({ objective }).success;
    expect(refused({ measures: { 'Quadriceps!': { value: 1 } } })).toBe(true);
    expect(
      refused({ measures: { 'knee.lsi.quadriceps': { involved: Number.POSITIVE_INFINITY } } }),
    ).toBe(true);
    expect(refused({ region: 'thumb' })).toBe(true);
    const test = { key: 'knee.lachman', result: 'positive' };
    expect(refused({ tests: [test, test] })).toBe(true);
    expect(refused({ tests: [{ ...test, interpretation: 'x'.repeat(201) }] })).toBe(true);
    expect(refused({ tests: [{ ...test, result: 'maybe' }] })).toBe(true);
  });
});
