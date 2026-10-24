import { describe, expect, it } from 'vitest';
import {
  assessmentParts,
  assessmentSuggestions,
  diagnosisCategoriesFileSchema,
  durationWeeks,
  searchConditions,
  suggestIrritability,
  suggestStage,
  weeksText,
  type AssessmentCondition,
  type AssessmentSettings,
} from './assessment';
import { confirmedCount, consultationSectionsSchema, signingBlockers } from './consultations';

// The placeholders from the client's Consultation SOP v2 §10.1 and §10.2 (the settings' rows).
const settings: AssessmentSettings = {
  irritabilityHighAbove: 5,
  irritabilityLowBelow: 3,
  acuteWeeksBelow: 3,
  chronicWeeksAbove: 12,
};

const condition = (
  conditionId: string,
  name: string,
  regions: AssessmentCondition['homeRegion'][],
  synonyms: string[] = [],
): AssessmentCondition => ({
  conditionId,
  name,
  synonyms,
  homeRegion: regions[0] ?? 'knee',
  categoryCode: null,
  listings: regions.map((region) => ({
    region,
    name,
    biomechanicalCause: null,
    specificExercise: null,
  })),
});

// CLN-06: irritability suggested from pain, stage from duration, a knowledge base condition.
describe('assessment', () => {
  it('suggests irritability from the worse pain score, at the SOP’s bands', () => {
    expect(suggestIrritability(6, 0, settings)).toEqual({
      level: 'high',
      worst: 6,
      from: 'pain_now',
    });
    expect(suggestIrritability(5, 2, settings)?.level).toBe('moderate');
    expect(suggestIrritability(3, undefined, settings)?.level).toBe('moderate');
    expect(suggestIrritability(2, 2, settings)?.level).toBe('low');
    expect(suggestIrritability(1, 7, settings)).toEqual({
      level: 'high',
      worst: 7,
      from: 'pain_activity',
    });
    expect(suggestIrritability(undefined, 4, settings)?.from).toBe('pain_activity');
    expect(suggestIrritability(undefined, undefined, settings)).toBeUndefined();
    expect(suggestIrritability('6', 11, settings)).toBeUndefined();
    // The thresholds are settings.
    expect(suggestIrritability(6, 0, { ...settings, irritabilityHighAbove: 6 })?.level).toBe(
      'moderate',
    );
  });

  it('suggests the stage from the duration in weeks', () => {
    expect(durationWeeks(14, 'days')).toBe(2);
    expect(durationWeeks(6, 'weeks')).toBe(6);
    expect(durationWeeks(1, 'years')).toBeCloseTo(52.18, 2);
    expect(durationWeeks(3, 'months')).toBeCloseTo(13.04, 2);
    expect(durationWeeks(6, undefined)).toBeUndefined();
    expect(durationWeeks(undefined, 'weeks')).toBeUndefined();
    expect(durationWeeks(6, 'fortnights')).toBeUndefined();
    expect(suggestStage(2.9, settings)).toBe('acute');
    expect(suggestStage(3, settings)).toBe('subacute');
    expect(suggestStage(12, settings)).toBe('subacute');
    expect(suggestStage(12.1, settings)).toBe('chronic');
    expect(suggestStage(undefined, settings)).toBeUndefined();
    expect(weeksText(6)).toBe('6 weeks');
    expect(weeksText(1 / 7)).toBe('1 day');
    expect(weeksText(104.36)).toBe('2 years');
  });

  it('reads the clinician’s Subjective answers before the patient’s', () => {
    const patient = { pain_now: 2, pain_activity: 4, duration: 2, duration_unit: 'weeks' };
    expect(assessmentSuggestions({}, patient, settings)).toEqual({
      irritability: { level: 'moderate', worst: 4, from: 'pain_activity' },
      stage: { stage: 'acute', weeks: 2 },
    });
    const confirmed = { pain_now: 8, duration_unit: 'months' };
    const changed = assessmentSuggestions(confirmed, patient, settings);
    expect(changed.irritability).toEqual({ level: 'high', worst: 8, from: 'pain_now' });
    expect(changed.stage?.stage).toBe('subacute');
    expect(changed.stage?.weeks).toBeCloseTo(8.7, 1);
    expect(assessmentSuggestions({}, {}, settings)).toEqual({
      irritability: undefined,
      stage: undefined,
    });
  });

  it('searches names, synonyms and IDs, the Objective’s workbook first', () => {
    const conditions = [
      condition('SHO-010', 'Calcific Tendinopathy', ['shoulder']),
      condition('KNE-004', 'Patellar Tendinopathy', ['knee']),
      condition('KNE-002', 'Chondromalacia Patella', ['knee']),
      condition('BSC-028', 'Patellofemoral chondral lesion', ['bone_stress'], ['trochlear']),
      condition('ELB-009', 'Medial Elbow Tendinopathy', ['elbow'], ['Golfer’s Elbow']),
    ];
    const names = (query: string, region: Parameters<typeof searchConditions>[2] = 'knee') =>
      searchConditions(conditions, query, region).map((c) => c.conditionId);
    expect(names('patell')).toEqual(['KNE-004', 'KNE-002', 'BSC-028']);
    expect(names('patell', 'bone_stress')).toEqual(['BSC-028', 'KNE-004', 'KNE-002']);
    expect(names('tendinopathy patellar')).toEqual(['KNE-004']);
    expect(names('GOLFER')).toEqual(['ELB-009']);
    expect(names('trochlear')).toEqual(['BSC-028']);
    expect(names('kne-002')).toEqual(['KNE-002']);
    expect(names('  ')).toEqual([]);
    expect(names('meniscus')).toEqual([]);
  });

  it('counts the four parts and blocks signing until all are in', () => {
    const empty = consultationSectionsSchema.parse({});
    expect(empty.assessment).toEqual({
      notes: '',
      conditionId: '',
      movement: '',
      irritability: '',
      stage: '',
      categoryCode: '',
      provisional: true,
    });
    expect(assessmentParts(empty.assessment)).toBe(0);
    // A draft from before CLN-06 (notes only) still reads.
    const old = consultationSectionsSchema.parse({ assessment: { notes: 'Seen' } });
    expect(old.assessment.notes).toBe('Seen');
    const whole = consultationSectionsSchema.parse({
      assessment: {
        conditionId: 'KNE-004',
        movement: '  ',
        irritability: 'moderate',
        stage: 'subacute',
      },
    });
    expect(confirmedCount(whole, 'assessment')).toBe(3);
    const reasons = (sections: typeof whole) =>
      signingBlockers(sections, {}, { planCatalog: { modalities: [], questionnaires: [] } }).filter(
        (blocker) => blocker.section === 'assessment',
      );
    expect(reasons(whole)).toHaveLength(1);
    expect(
      reasons({ ...whole, assessment: { ...whole.assessment, movement: 'Dynamic valgus' } }),
    ).toEqual([]);
    expect(
      consultationSectionsSchema.safeParse({ assessment: { conditionId: 'knee-4' } }).success,
    ).toBe(false);
    expect(
      consultationSectionsSchema.safeParse({ assessment: { movement: 'x'.repeat(201) } }).success,
    ).toBe(false);
    expect(consultationSectionsSchema.safeParse({ assessment: { stage: 'healed' } }).success).toBe(
      false,
    );
  });

  it('takes only a well formed categories file', () => {
    const file = {
      source: 'The client’s list',
      categories: [{ code: 'knee_pfps', name: 'Knee - PFPS' }],
      conditions: { 'KNE-001': 'knee_pfps' },
    };
    expect(diagnosisCategoriesFileSchema.safeParse(file).success).toBe(true);
    expect(
      diagnosisCategoriesFileSchema.safeParse({ ...file, conditions: { 'kne-1': 'knee_pfps' } })
        .success,
    ).toBe(false);
    expect(
      diagnosisCategoriesFileSchema.safeParse({
        ...file,
        categories: [{ code: 'Knee PFPS', name: 'Knee - PFPS' }],
      }).success,
    ).toBe(false);
  });
});
