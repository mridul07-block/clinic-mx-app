import { describe, expect, it } from 'vitest';
import {
  alertDisplay,
  evaluateRedFlags,
  questionsFor,
  redFlagRulesSchema,
  screeningQuestions,
  triggerText,
  type RedFlagRule,
  type ScreeningAnswers,
  type ScreeningThresholds,
} from './red-flags';

// SET-10: the evaluator the health form submit runs (INT-10). The client's rules are tested one by
// one in packages/db/src/knowledge/red-flag-rules.test.ts; these use small made-up rules.
const thresholds: ScreeningThresholds = {
  'screening.weight_loss_kg': 5,
  'screening.weight_loss_months': 6,
  'screening.morning_stiffness_minutes': 60,
};

const rule = (
  overrides: Partial<RedFlagRule> & Pick<RedFlagRule, 'key' | 'trigger'>,
): RedFlagRule => ({
  name: overrides.key,
  regions: [],
  triage: 'monitor_with_caution',
  action: 'Act.',
  source: 'Test',
  signedOff: false,
  ...overrides,
});

/** Every question asked for the region answered no (numbers 0), then the given answers. */
function answered(region: Parameters<typeof questionsFor>[0], given: ScreeningAnswers = {}) {
  const answers: ScreeningAnswers = { ...given };
  for (let pass = 0; pass < 2; pass++) {
    for (const key of questionsFor(region, answers)) {
      if (answers[key] === undefined)
        answers[key] =
          key.endsWith('_kg') || key.endsWith('_months') || key.endsWith('_minutes') ? 0 : false;
    }
  }
  return answers;
}

describe('red flag screening', () => {
  it('shows the five triage categories as three alert tiers', () => {
    expect(alertDisplay('immediate_emergency')).toBe('emergency');
    expect(alertDisplay('urgent_medical_referral')).toBe('review');
    expect(alertDisplay('urgent_imaging')).toBe('review');
    expect(alertDisplay('specialist_referral')).toBe('review');
    expect(alertDisplay('monitor_with_caution')).toBe('information');
  });

  it('asks a follow-up only after a yes or no question', () => {
    for (const [key, question] of Object.entries(screeningQuestions)) {
      const after: string | undefined = 'askedWhen' in question ? question.askedWhen : undefined;
      if (after === undefined) continue;
      // Looked up as any string, so a follow-up naming no question fails here too.
      const questions: Partial<Record<string, { kind: string }>> = screeningQuestions;
      expect(questions[after]?.kind, key).toBe('yes_no');
    }
  });

  it('asks the region questions only for that region, and follow-ups only after a yes', () => {
    expect(questionsFor('back')).toContain('back_saddle');
    expect(questionsFor('knee')).not.toContain('back_saddle');
    expect(questionsFor('neck')).toContain('neck_double_vision');
    expect(questionsFor('knee')).not.toContain('weight_loss_kg');
    expect(questionsFor('knee', { weight_loss: true })).toContain('weight_loss_kg');
  });

  it('raises a rule in its regions only, most urgent first', () => {
    const rules = [
      rule({ key: 'b', trigger: { all: [{ question: 'recent_trauma', is: 'yes' }] } }),
      rule({
        key: 'a',
        regions: ['back'],
        triage: 'immediate_emergency',
        trigger: { any: [{ question: 'back_saddle', is: 'yes' }] },
      }),
    ];
    const back = evaluateRedFlags(
      rules,
      answered('back', { back_saddle: true, recent_trauma: true }),
      { region: 'back', age: 40 },
      thresholds,
    );
    expect(back.raised.map((f) => [f.key, f.display])).toEqual([
      ['a', 'emergency'],
      ['b', 'information'],
    ]);
    expect(back.display).toBe('emergency');
    const knee = evaluateRedFlags(
      rules,
      answered('knee', { back_saddle: true }),
      { region: 'knee', age: 40 },
      thresholds,
    );
    expect(knee.raised).toEqual([]);
    expect(knee.display).toBeNull();
  });

  it('compares numbers with the settings', () => {
    const rules = [
      rule({
        key: 'weight',
        triage: 'urgent_medical_referral',
        trigger: {
          all: [
            { question: 'weight_loss', is: 'yes' },
            { question: 'weight_loss_kg', atLeast: { setting: 'screening.weight_loss_kg' } },
            { question: 'weight_loss_months', atMost: { setting: 'screening.weight_loss_months' } },
          ],
        },
      }),
    ];
    const run = (kg: number, months: number, limits = thresholds) =>
      evaluateRedFlags(
        rules,
        answered('hip', { weight_loss: true, weight_loss_kg: kg, weight_loss_months: months }),
        { region: 'hip', age: 40 },
        limits,
      ).raised.length;
    expect(run(4, 3)).toBe(0);
    expect(run(5, 6)).toBe(1);
    expect(run(5, 7)).toBe(0);
    expect(run(4, 3, { ...thresholds, 'screening.weight_loss_kg': 4 })).toBe(1);
  });

  it('needs every "all" condition and one "any" condition, and the age when asked', () => {
    const rules = [
      rule({
        key: 'cluster',
        triage: 'urgent_imaging',
        trigger: {
          all: [{ age: { atLeast: 50 } }],
          any: [
            { question: 'cancer_history', is: 'yes' },
            { question: 'weight_loss', is: 'yes' },
          ],
        },
      }),
    ];
    const run = (age: number | null, given: ScreeningAnswers) =>
      evaluateRedFlags(rules, answered('shoulder', given), { region: 'shoulder', age }, thresholds)
        .raised.length;
    expect(run(55, { cancer_history: true })).toBe(1);
    expect(run(49, { cancer_history: true })).toBe(0);
    expect(run(55, {})).toBe(0);
    expect(run(null, { cancer_history: true })).toBe(0);
  });

  it('never reads an unanswered question as no: it asks for review', () => {
    const answers = answered('back');
    delete answers.back_bladder;
    const result = evaluateRedFlags([], answers, { region: 'back', age: 30 }, thresholds);
    expect(result.missing).toEqual(['back_bladder']);
    expect(result.display).toBe('review');
    const followUp = evaluateRedFlags(
      [],
      { ...answered('knee'), weight_loss: true, weight_loss_kg: null },
      { region: 'knee', age: 30 },
      thresholds,
    );
    expect(followUp.missing).toEqual(['weight_loss_kg', 'weight_loss_months']);
  });

  it('refuses rules that name unknown questions, have no condition or repeat a key', () => {
    const ok = rule({ key: 'x', trigger: { all: [{ question: 'night_pain', is: 'yes' }] } });
    expect(redFlagRulesSchema.safeParse([ok]).success).toBe(true);
    expect(
      redFlagRulesSchema.safeParse([{ ...ok, trigger: { all: [{ question: 'nope', is: 'yes' }] } }])
        .success,
    ).toBe(false);
    expect(redFlagRulesSchema.safeParse([{ ...ok, trigger: {} }]).success).toBe(false);
    expect(redFlagRulesSchema.safeParse([ok, ok]).success).toBe(false);
    expect(redFlagRulesSchema.safeParse([{ ...ok, triage: 'urgent' }]).success).toBe(false);
  });

  it('says a trigger in words', () => {
    expect(triggerText({ all: [{ question: 'recent_trauma', is: 'yes' }] })).toBe(
      '“Any recent trauma or accident?” is yes',
    );
    expect(
      triggerText(
        {
          all: [
            {
              question: 'morning_stiffness_minutes',
              atLeast: { setting: 'screening.morning_stiffness_minutes' },
            },
          ],
        },
        thresholds,
      ),
    ).toContain('is at least 60 minutes');
    expect(
      triggerText({
        all: [{ age: { atLeast: 50 } }],
        any: [{ question: 'cancer_history', is: 'yes' }],
      }),
    ).toBe('All of: Age is at least 50; and any of: “Do you have a history of cancer?” is yes');
  });
});
