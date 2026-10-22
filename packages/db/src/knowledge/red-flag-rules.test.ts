import {
  evaluateRedFlags,
  questionsFor,
  screeningQuestions,
  screeningRegions,
  type RedFlagRule,
  type ScreeningAnswers,
  type ScreeningRegion,
  type ScreeningThresholds,
} from '@clinic-mx/schemas';
import { beforeAll, describe, expect, it } from 'vitest';
import { readRulesFile } from './paths';
import { parseRedFlagRules } from './red-flags';

// SET-10 done when: rules and tiers are configurable; a test for each emergency rule. These read
// the committed rules file, the version the import records. Thresholds are the settings' values.
let rules: RedFlagRule[];
beforeAll(async () => {
  rules = parseRedFlagRules(await readRulesFile());
});

const thresholds: ScreeningThresholds = {
  'screening.weight_loss_kg': 5,
  'screening.weight_loss_months': 6,
  'screening.morning_stiffness_minutes': 60,
};

/** Every question asked for the region answered no (numbers 0), then the given answers. */
function answered(region: ScreeningRegion, given: ScreeningAnswers = {}): ScreeningAnswers {
  const answers: ScreeningAnswers = { ...given };
  for (let pass = 0; pass < 2; pass++) {
    for (const key of questionsFor(region, answers)) {
      if (answers[key] === undefined) {
        answers[key] = screeningQuestions[key].kind === 'number' ? 0 : false;
      }
    }
  }
  return answers;
}

const raised = (region: ScreeningRegion, given: ScreeningAnswers, age: number | null = 40) =>
  evaluateRedFlags(rules, answered(region, given), { region, age }, thresholds).raised;

/**
 * One hand-written case per Immediate emergency rule: the answers that raise it, the regions it
 * must raise in, and the regions it must stay quiet in.
 */
const emergencyCases: {
  key: string;
  answers: ScreeningAnswers[];
  raisesIn: ScreeningRegion[];
  quietIn: ScreeningRegion[];
}[] = [
  {
    key: 'everywhere.dvt_pe',
    answers: [{ calf_chest_breath: true }],
    raisesIn: [...screeningRegions],
    quietIn: [],
  },
  {
    key: 'everywhere.cauda_equina',
    answers: [{ bowel_bladder_change: true }, { saddle_numbness: true }],
    raisesIn: [...screeningRegions],
    quietIn: [],
  },
  {
    key: 'everywhere.septic_joint',
    answers: [{ hot_swollen_joint: true, fever_sweats: true }],
    raisesIn: ['knee', 'hip', 'elbow', 'shoulder'],
    quietIn: [],
  },
  {
    key: 'everywhere.fever',
    answers: [{ fever_sweats: true }],
    raisesIn: [...screeningRegions],
    quietIn: [],
  },
  {
    key: 'back.cauda_equina',
    answers: [
      { back_bladder: true },
      { back_bowel: true },
      { back_saddle: true },
      { back_both_legs: true },
    ],
    raisesIn: ['back'],
    quietIn: ['neck', 'knee', 'hip'],
  },
  {
    key: 'neck.arterial_dysfunction',
    answers: [
      { neck_dizziness: true },
      { neck_double_vision: true },
      { neck_speech_swallow: true },
    ],
    raisesIn: ['neck'],
    quietIn: ['back', 'shoulder'],
  },
];

describe('the red flag rules file', () => {
  it('parses, with unique keys, known questions and a source for every rule', () => {
    expect(rules.length).toBeGreaterThan(0);
    expect(rules.every((rule) => rule.source.startsWith('Framework'))).toBe(true);
  });

  it('has a hand-written test for every Immediate emergency rule', () => {
    expect(
      rules
        .filter((rule) => rule.triage === 'immediate_emergency')
        .map((rule) => rule.key)
        .sort(),
    ).toEqual(emergencyCases.map((c) => c.key).sort());
  });

  for (const emergency of emergencyCases) {
    it(`raises ${emergency.key} as an emergency, and only when answered yes`, () => {
      for (const answers of emergency.answers) {
        for (const region of emergency.raisesIn) {
          const flag = raised(region, answers).find((f) => f.key === emergency.key);
          expect(flag, `${region} ${JSON.stringify(answers)}`).toMatchObject({
            triage: 'immediate_emergency',
            display: 'emergency',
          });
        }
        for (const region of emergency.quietIn) {
          expect(
            raised(region, answers).map((f) => f.key),
            `${region} ${JSON.stringify(answers)}`,
          ).not.toContain(emergency.key);
        }
      }
      for (const region of [...emergency.raisesIn, ...emergency.quietIn]) {
        expect(raised(region, {}), `${region} all no`).toEqual([]);
      }
    });
  }

  it('raises nothing when every answer is no, at any age', () => {
    for (const region of screeningRegions) {
      for (const age of [null, 20, 70]) expect(raised(region, {}, age)).toEqual([]);
    }
  });

  it('reads the weight loss and morning stiffness thresholds from settings', () => {
    const weight = (kg: number, months: number) =>
      raised('hip', { weight_loss: true, weight_loss_kg: kg, weight_loss_months: months }).map(
        (f) => f.key,
      );
    expect(weight(4, 3)).toEqual(['everywhere.weight_loss_some']);
    expect(weight(5, 6)).toEqual(['everywhere.weight_loss', 'everywhere.weight_loss_some']);
    expect(raised('knee', { morning_stiffness_minutes: 59 })).toEqual([]);
    expect(raised('knee', { morning_stiffness_minutes: 60 }).map((f) => f.key)).toEqual([
      'everywhere.morning_stiffness',
    ]);
  });

  it('raises the malignancy cluster from 50 years with a history of cancer or weight loss', () => {
    const keys = (age: number) => raised('back', { cancer_history: true }, age).map((f) => f.key);
    expect(keys(50)).toContain('everywhere.malignancy_cluster');
    expect(keys(49)).not.toContain('everywhere.malignancy_cluster');
  });

  it('marks every rule as awaiting clinical sign-off until the client signs', () => {
    expect(rules.filter((rule) => rule.signedOff)).toEqual([]);
  });
});
