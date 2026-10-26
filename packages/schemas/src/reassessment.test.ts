import { describe, expect, it } from 'vitest';
import type { KnowledgeMeasure } from './objective';
import {
  entryOfReassessment,
  reassessmentBlockers,
  reassessmentChangeText,
  reassessmentDecisionSchema,
  reassessmentEntrySchema,
  reassessmentIdOf,
  reassessmentRecordings,
} from './reassessment';
import { emptySessionNote, sessionNoteBlockers, sessionNoteSchema } from './sessions';

const measure = (extra: Partial<KnowledgeMeasure>): KnowledgeMeasure => ({
  key: 'knee.marker.primary_task_pain_nrs_0_10', // gitleaks:allow
  region: 'knee',
  section: 'RE-TESTABLE MARKERS — BASELINE vs CURRENT',
  name: 'Primary task pain (NRS 0-10)',
  unit: '/10',
  kind: 'marker',
  inverted: false,
  rule: { kind: 'none' },
  direction: 'Lower is better',
  note: null,
  ...extra,
});
const pain = measure({});
const effusion = measure({
  key: 'knee.marker.effusion_grade_0_3', // gitleaks:allow
  name: 'Effusion grade (0-3)',
  unit: 'grade',
  kind: 'grade',
});
const quadriceps = measure({
  key: 'knee.lsi.quadriceps', // gitleaks:allow
  section: 'STRENGTH',
  name: 'Quadriceps',
  unit: 'kg',
  kind: 'lsi',
  rule: { kind: 'lsi', passAt: 0.9 },
  direction: null,
});
const measures = [quadriceps, pain, effusion];
const entry = (extra: object) => reassessmentEntrySchema.parse(extra);

// OUT-05 done when: the treating physio records the markers at session 4 and the consultant
// reviews and signs the decision. Decisions (user, 26 October 2026): exactly the baseline's
// measures, both sides of a side by side one; each recorded or Not tested with a reason before
// closing; the consultant writes and signs the decision.
describe('the session 4 reassessment', () => {
  it('holds Close session until each measure is recorded, both sides where paired, or explained', () => {
    expect(reassessmentBlockers({}, measures)).toEqual([
      'Record both sides of Quadriceps, or mark it Not tested with a reason.',
      'Record Primary task pain (NRS 0-10), or mark it Not tested with a reason.',
      'Record Effusion grade (0-3), or mark it Not tested with a reason.',
    ]);
    expect(
      reassessmentBlockers(
        {
          [quadriceps.key]: entry({ involved: 36 }),
          [pain.key]: entry({ value: 3 }),
          [effusion.key]: entry({ notTested: true, reason: '  ' }),
        },
        measures,
      ),
    ).toEqual([
      'Record both sides of Quadriceps, or mark it Not tested with a reason.',
      'Give the reason Effusion grade (0-3) was not tested.',
    ]);
    expect(reassessmentBlockers({ [effusion.key]: entry({ value: 5 }) }, [effusion])).toEqual([
      'Rate Effusion grade (0-3) from 0 to 3.',
    ]);
    const done = {
      [quadriceps.key]: entry({ involved: 36, uninvolved: 39 }),
      [pain.key]: entry({ value: 3 }),
      [effusion.key]: entry({ notTested: true, reason: ' Not assessable ', value: 1 }),
    };
    expect(reassessmentBlockers(done, measures)).toEqual([]);
    expect(reassessmentRecordings(done, measures)).toEqual({
      readings: [
        { key: quadriceps.key, limb: 'involved', value: 36, unit: 'kg' },
        { key: quadriceps.key, limb: 'uninvolved', value: 39, unit: 'kg' },
        { key: pain.key, limb: null, value: 3, unit: '/10' },
      ],
      notTested: { [effusion.key]: 'Not assessable' },
    });
  });

  it('words the change from the baseline', () => {
    const now = entryOfReassessment(entry({ involved: 36, uninvolved: 39 }));
    expect(now).toEqual({ involved: 36, uninvolved: 39 });
    expect(reassessmentChangeText(quadriceps, { involved: 32, uninvolved: 40 }, now)).toBe(
      'LSI 80% → 92%',
    );
    expect(reassessmentChangeText(pain, { value: 6 }, { value: 3 })).toBe('6/10 → 3/10');
    expect(reassessmentChangeText(pain, {}, { value: 3 }), 'not tested at baseline').toBe('');
  });

  it('sits in the session note, which closes on it, and older notes still read', () => {
    expect(sessionNoteSchema.parse({}).reassessment).toEqual({});
    expect(sessionNoteBlockers(emptySessionNote(), [], [], [pain])).toContain(
      'Record Primary task pain (NRS 0-10), or mark it Not tested with a reason.',
    );
    expect(sessionNoteSchema.safeParse({ reassessment: { 'Not a key': {} } }).success).toBe(false);
  });

  it('takes a written decision, and reads the task’s reassessment', () => {
    const id = '00000000-0000-4000-8000-000000000a01';
    expect(
      reassessmentDecisionSchema.parse({ reassessmentId: id, decision: '  Continue the plan. ' }),
    ).toEqual({ reassessmentId: id, decision: 'Continue the plan.' });
    expect(
      reassessmentDecisionSchema.safeParse({ reassessmentId: id, decision: ' ' }).success,
    ).toBe(false);
    expect(
      reassessmentDecisionSchema.safeParse({ reassessmentId: id, decision: 'x'.repeat(2001) })
        .success,
    ).toBe(false);
    expect(reassessmentIdOf({ reassessmentId: id, sessionNumber: 4 })).toBe(id);
    expect(reassessmentIdOf({})).toBeUndefined();
  });
});
