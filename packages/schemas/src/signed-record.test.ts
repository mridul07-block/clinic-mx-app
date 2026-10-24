import { describe, expect, it } from 'vitest';
import type { AssessmentCatalog } from './assessment';
import { consultationSectionsSchema, signingBlockers } from './consultations';
import type { KnowledgeMeasure, KnowledgeSpecialTest } from './objective';
import type { PlanCatalog } from './plan';
import { addendumSchema, signedRecord, type SignContext } from './signed-record';

const quadriceps: KnowledgeMeasure = {
  key: 'knee.lsi.quadriceps',
  region: 'knee',
  section: 'Strength',
  name: 'Quadriceps',
  unit: 'kg',
  kind: 'lsi',
  inverted: false,
  rule: { kind: 'lsi', passAt: 0.9 },
  direction: null,
  note: null,
};
const effusion: KnowledgeMeasure = {
  ...quadriceps,
  key: 'knee.marker.effusion_grade_0_3', // gitleaks:allow (a knowledge base key, not a secret)
  name: 'Effusion grade (0-3)',
  unit: 'grade',
  kind: 'grade',
  rule: { kind: 'none' },
};
const lachman: KnowledgeSpecialTest = {
  key: 'knee.lachman',
  region: 'knee',
  category: 'Ligament',
  test: 'Lachman',
  targets: 'ACL',
  positiveFinding: 'Soft end-feel',
  clinicalNote: '',
};
const assessmentCatalog: AssessmentCatalog = {
  conditions: [
    {
      conditionId: 'KNE-004',
      name: 'Patellar Tendinopathy',
      synonyms: [],
      homeRegion: 'knee',
      categoryCode: null,
      listings: [],
    },
    {
      conditionId: 'KNE-001',
      name: 'Patellofemoral Pain Syndrome',
      synonyms: [],
      homeRegion: 'knee',
      categoryCode: 'knee_pfps',
      listings: [],
    },
  ],
  categories: [
    { code: 'knee_pfps', name: 'Knee - PFPS' },
    { code: 'knee_others', name: 'Knee- Others' },
  ],
};
const planCatalog: PlanCatalog = {
  modalities: [{ key: 'laser', name: 'Laser', precautions: [], signedOff: false }],
  questionnaires: [
    { key: 'visa_p', name: 'VISA-P', regions: ['knee'], useFor: 'Patellar tendinopathy' },
  ],
};
const context: SignContext = {
  patientAnswers: { region: 'knee', sex: 'male' },
  objectiveCatalog: { measures: [quadriceps, effusion], specialTests: [lachman] },
  assessmentCatalog,
  planCatalog,
  planDefaults: { visitDate: '2026-10-24', reviewWeeks: 6, consultantId: 'consultant' },
  treatingPhysioIds: ['consultant', 'colleague'],
};

const sections = (extra: Record<string, unknown> = {}) =>
  consultationSectionsSchema.parse({
    objective: {
      region: 'knee',
      side: 'right',
      measures: {
        'knee.lsi.quadriceps': { involved: 32, uninvolved: 40 },
        'knee.marker.effusion_grade_0_3': { value: 2 },
      },
      tests: [{ key: 'knee.lachman', result: 'negative', interpretation: 'Firm end-feel' }],
    },
    assessment: {
      conditionId: 'KNE-004',
      movement: ' Quad dominance ',
      irritability: 'moderate',
      stage: 'subacute',
      categoryCode: 'knee_others',
    },
    plan: {
      goals: [{ text: 'Run 10 km again', patient: true }, { text: '  ' }],
      modalities: [{ key: 'laser' }],
      homeProgramme: [{ exercise: 'Spanish squat', dose: '5 x 45 s' }, { exercise: '' }],
    },
    ...extra,
  });

// CLN-09: signing writes the record's rows from the sections, checked against the version.
describe('signed record', () => {
  it('turns the sections into the record’s rows', () => {
    const { problems, rows } = signedRecord(sections(), context);
    expect(problems).toEqual([]);
    expect(rows.measures).toEqual([
      { key: 'knee.lsi.quadriceps', limb: 'involved', side: 'right', value: 32, unit: 'kg' },
      { key: 'knee.lsi.quadriceps', limb: 'uninvolved', side: 'left', value: 40, unit: 'kg' },
      {
        key: 'knee.marker.effusion_grade_0_3', // gitleaks:allow (a knowledge base key)
        limb: null,
        side: null,
        value: 2,
        unit: 'grade',
      },
    ]);
    expect(rows.tests).toEqual([
      { key: 'knee.lachman', result: 'negative', interpretation: 'Firm end-feel' },
    ]);
    expect(rows.diagnosis).toEqual({
      conditionId: 'KNE-004',
      movement: 'Quad dominance',
      irritability: 'moderate',
      stage: 'subacute',
      categoryCode: 'knee_others',
      provisional: true,
    });
    expect(rows.plan).toMatchObject({
      goals: [{ text: 'Run 10 km again', patient: true }],
      modalities: [{ key: 'laser', reason: '' }],
      homeProgramme: [{ exercise: 'Spanish squat', dose: '5 x 45 s', note: '' }],
      reviewDate: '2026-12-05',
      questionnaires: ['visa_p'],
      treatingPhysioId: 'consultant',
    });
  });

  it('keeps one side of a measure, no side when none was chosen, and a mapped category', () => {
    const partial = sections({
      objective: {
        region: 'knee',
        side: '',
        measures: { 'knee.lsi.quadriceps': { involved: 32 } },
        tests: [],
      },
      assessment: {
        conditionId: 'KNE-001',
        movement: 'Valgus',
        irritability: 'low',
        stage: 'chronic',
        categoryCode: 'knee_others',
      },
    });
    const { rows } = signedRecord(partial, context);
    expect(rows.measures).toEqual([
      { key: 'knee.lsi.quadriceps', limb: 'involved', side: null, value: 32, unit: 'kg' },
    ]);
    // The condition's mapping codes the category, whatever was picked.
    expect(rows.diagnosis.categoryCode).toBe('knee_pfps');
  });

  it('refuses what the version no longer holds', () => {
    const stale = sections({
      objective: {
        region: 'knee',
        side: 'left',
        measures: { 'knee.lsi.retired': { involved: 1 } },
        tests: [{ key: 'knee.retired', result: 'positive' }],
      },
      assessment: {
        conditionId: 'KNE-999',
        movement: 'x',
        irritability: 'low',
        stage: 'acute',
        categoryCode: 'gone',
      },
      plan: { modalities: [{ key: 'cupping' }], questionnaires: ['koos'], treatingPhysioId: '' },
    });
    const { problems } = signedRecord(stale, {
      ...context,
      treatingPhysioIds: ['colleague'],
    });
    expect(problems).toEqual([
      'Measure "knee.lsi.retired" is not in this consultation\'s knowledge base version.',
      'Special test "knee.retired" is not in this consultation\'s knowledge base version.',
      'Condition "KNE-999" is not in this consultation\'s knowledge base version.',
      'Diagnosis category "gone" is not in this consultation\'s knowledge base version.',
      'Modality "cupping" is not in this consultation\'s knowledge base version.',
      'Questionnaire "koos" is not in this consultation\'s knowledge base version.',
      'Choose a treating physio who treats patients at this centre.',
    ]);
  });

  it('blocks signing until each special test added has a result', () => {
    const untested = sections({
      objective: { region: 'knee', tests: [{ key: 'knee.lachman' }, { key: 'knee.other' }] },
    });
    const reasons = signingBlockers(untested, context.patientAnswers, {
      planCatalog,
      specialTests: [lachman],
    }).filter((blocker) => blocker.section === 'objective');
    expect(reasons).toEqual([
      {
        section: 'objective',
        reason: 'Choose a result for each special test added: Lachman, knee.other.',
      },
    ]);
    expect(
      signingBlockers(sections(), context.patientAnswers, { planCatalog }).filter(
        (blocker) => blocker.section === 'objective',
      ),
    ).toEqual([]);
  });

  it('takes an addendum of 1 to 5,000 characters', () => {
    const id = '00000000-0000-4000-8000-000000000a01';
    expect(addendumSchema.parse({ consultationId: id, text: '  Seen again  ' }).text).toBe(
      'Seen again',
    );
    expect(addendumSchema.safeParse({ consultationId: id, text: '   ' }).success).toBe(false);
    expect(addendumSchema.safeParse({ consultationId: id, text: 'x'.repeat(5001) }).success).toBe(
      false,
    );
  });
});
