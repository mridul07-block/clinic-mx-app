import { describe, expect, it } from 'vitest';
import {
  changeFromBaseline,
  questionnaireDefinitionSchema,
  questionnaireFillable,
  questionnaireState,
  keptAnswers,
  questionnaireLine,
  questionnaireSubmissionSchema,
  questionnaireSummary,
  scoreQuestionnaire,
  type QuestionnaireDefinition,
} from './questionnaires';

// SET-08: instruments are knowledge data with fixed, tested scoring. Generated test instruments
// only (rule 12 and no invented clinical content).
const choice = (key: string, values = [0, 1, 2, 3, 4]) => ({
  kind: 'choice' as const,
  key,
  text: `Test item ${key}`,
  options: values.map((value) => ({ label: `Answer ${String(value)}`, value })),
});
const scale = (key: string, kind: 'scale' | 'activity' = 'scale') => ({
  kind,
  key,
  text: `Test item ${key}`,
  min: 0,
  max: 10,
  minLabel: 'Low',
  maxLabel: 'High',
});
/** The range each rule gives over four items scored 0 to 4. */
const rangeFor = {
  sum: { min: 0, max: 16 },
  mean: { min: 0, max: 4 },
  percent: { min: 0, max: 100 },
};
const fake = (
  scoring: Partial<QuestionnaireDefinition['scoring']> = {},
): QuestionnaireDefinition => {
  const method = scoring.method ?? 'sum';
  return questionnaireDefinitionSchema.parse({
    version: 'test-1',
    items: ['a', 'b', 'c', 'd'].map((key) => choice(key)),
    scoring: { method, maxMissing: 1, ...scoring },
    range: rangeFor[method],
    better: 'lower',
    meaningfulChange: 3,
    source: 'Generated test instrument',
  });
};
/** Why a definition is refused, or nothing when it is accepted. */
const refusal = (change: Record<string, unknown>): string | undefined =>
  questionnaireDefinitionSchema.safeParse({ ...fake(), ...change }).error?.issues[0]?.message;

describe('an instrument’s definition', () => {
  it('takes items, scoring, range, direction and meaningful change', () => {
    expect(fake().scoring).toEqual({ method: 'sum', maxMissing: 1, invert: false });
    expect(refusal({})).toBeUndefined();
  });

  it('refuses each definition that cannot score as it says, for its own reason', () => {
    expect(refusal({ items: [choice('a'), choice('a'), choice('b'), choice('c')] })).toBe(
      'Each item has its own key.',
    );
    expect(refusal({ scoring: { method: 'sum', maxMissing: 4 } })).toBe(
      'At least one item must be answered for a score.',
    );
    expect(refusal({ scoring: { method: 'sum', maxMissing: 0, invert: true } })).toBe(
      'Only a percent score is inverted.',
    );
    expect(refusal({ meaningfulChange: 0 })).toBeDefined();
    const one = { scoring: { method: 'sum', maxMissing: 0 } };
    expect(
      refusal({ ...one, items: [{ ...scale('x'), min: 5, max: 5 }], range: { min: 5, max: 6 } }),
    ).toBe('A scale runs from its minimum up to its maximum.');
    expect(
      refusal({
        ...one,
        items: [
          {
            ...choice('x'),
            options: [
              { label: 'One', value: 1 },
              { label: 'Also', value: 1 },
            ],
          },
        ],
        range: { min: 1, max: 2 },
      }),
    ).toBe('Each answer scores its own value.');
  });

  it('holds the range to what the rule can give, and mixed items to rules that keep them apart', () => {
    expect(refusal({ range: { min: 0, max: 20 } })).toBe(
      'The range is what the scoring rule can give.',
    );
    expect(
      refusal({ scoring: { method: 'percent', maxMissing: 1 }, range: { min: 0, max: 16 } }),
    ).toBe('The range is what the scoring rule can give.');
    // Items scored 0 to 4 and 0 to 10: no average, and no missing one stood in for.
    const mixed = { items: [choice('a'), scale('b')] };
    expect(
      refusal({ ...mixed, scoring: { method: 'sum', maxMissing: 1 }, range: { min: 0, max: 14 } }),
    ).toBe('Every item scores over the same range for this scoring rule.');
    expect(
      refusal({ ...mixed, scoring: { method: 'mean', maxMissing: 0 }, range: { min: 0, max: 10 } }),
    ).toBe('Every item scores over the same range for this scoring rule.');
    expect(
      refusal({ ...mixed, scoring: { method: 'sum', maxMissing: 0 }, range: { min: 0, max: 14 } }),
    ).toBeUndefined();
    expect(
      refusal({
        ...mixed,
        scoring: { method: 'percent', maxMissing: 1 },
        range: { min: 0, max: 100 },
      }),
    ).toBeUndefined();
  });
});

describe('scoring', () => {
  it('adds the answers, scaling up for an allowed missing item, and gives no score past that', () => {
    expect(scoreQuestionnaire(fake(), { a: 1, b: 2, c: 3, d: 4 })).toEqual({
      status: 'scored',
      score: 10,
      answered: 4,
      missing: 0,
    });
    // One missing: 1 + 2 + 4 over three items, scaled to four (9.33…, one decimal).
    expect(scoreQuestionnaire(fake(), { a: 1, b: 2, d: 4 })).toMatchObject({
      status: 'scored',
      score: 9.3,
      missing: 1,
    });
    expect(scoreQuestionnaire(fake(), { a: 1, b: 2 })).toEqual({
      status: 'not_scored',
      reason: 'too_many_missing',
      answered: 2,
      missing: 2,
    });
    expect(scoreQuestionnaire(fake({ maxMissing: 3 }), {})).toMatchObject({ status: 'not_scored' });
  });

  it('counts an answer the item does not allow as missing', () => {
    expect(scoreQuestionnaire(fake(), { a: 1, b: 2, c: 3, d: 9 })).toMatchObject({
      score: 8,
      missing: 1,
    });
    expect(scoreQuestionnaire(fake(), { a: 1, b: 2.5, c: 3, d: Number.NaN })).toMatchObject({
      status: 'not_scored',
      missing: 2,
    });
  });

  it('averages, or gives the percent of points possible, inverted where higher is better', () => {
    expect(scoreQuestionnaire(fake({ method: 'mean' }), { a: 1, b: 2, c: 2, d: 4 })).toMatchObject({
      score: 2.3,
    });
    // 7 of 12 points possible on the three answered items: 58.3%.
    expect(scoreQuestionnaire(fake({ method: 'percent' }), { a: 1, b: 2, d: 4 })).toMatchObject({
      score: 58.3,
    });
    expect(
      scoreQuestionnaire(fake({ method: 'percent', invert: true }), { a: 1, b: 2, d: 4 }),
    ).toMatchObject({ score: 41.7 });
  });

  it('rounds an exact half up, and counts points from each item’s own lowest answer', () => {
    // Twenty items scored 0 to 4: 23 of 80 is 28.75%, and 49 of 80 inverted is 38.75%.
    const twenty = (invert: boolean) =>
      questionnaireDefinitionSchema.parse({
        ...fake(),
        items: Array.from({ length: 20 }, (_, index) => choice(['i', String(index)].join(''))),
        scoring: { method: 'percent', maxMissing: 0, invert },
        range: { min: 0, max: 100 },
      });
    const answers = (points: number) =>
      Object.fromEntries(
        Array.from({ length: 20 }, (_, index) => [
          ['i', String(index)].join(''),
          Math.min(4, Math.max(0, points - index * 4)),
        ]),
      );
    expect(scoreQuestionnaire(twenty(false), answers(23))).toMatchObject({ score: 28.8 });
    expect(scoreQuestionnaire(twenty(true), answers(49))).toMatchObject({ score: 38.8 });
    // Answers scored 1 to 5: 3 and 5 are 6 of 8 points above the lowest, 75%.
    const fromOne = questionnaireDefinitionSchema.parse({
      ...fake(),
      items: [choice('a', [1, 2, 3, 4, 5]), choice('b', [1, 2, 3, 4, 5])],
      scoring: { method: 'percent', maxMissing: 0 },
      range: { min: 0, max: 100 },
    });
    expect(scoreQuestionnaire(fromOne, { a: 3, b: 5 })).toMatchObject({ score: 75 });
  });

  it('scores scales and named activities by their own ends', () => {
    const scaled = questionnaireDefinitionSchema.parse({
      ...fake(),
      items: [scale('one', 'activity'), scale('two', 'activity'), scale('three')],
      scoring: { method: 'mean', maxMissing: 2 },
      range: { min: 0, max: 10 },
    });
    expect(scoreQuestionnaire(scaled, { one: 3, two: 6 })).toMatchObject({
      score: 4.5,
      missing: 1,
    });
    expect(scoreQuestionnaire(scaled, { one: 11, two: 6 })).toMatchObject({ score: 6, missing: 2 });
  });
});

describe('the change from baseline', () => {
  it('is positive when better by the instrument’s direction, and met at its meaningful change', () => {
    expect(changeFromBaseline({ better: 'lower', meaningfulChange: 3 }, 12, 9)).toEqual({
      change: 3,
      met: true,
    });
    expect(changeFromBaseline({ better: 'lower', meaningfulChange: 3 }, 12, 10)).toEqual({
      change: 2,
      met: false,
    });
    expect(changeFromBaseline({ better: 'higher', meaningfulChange: 2 }, 4, 3)).toEqual({
      change: -1,
      met: false,
    });
    expect(changeFromBaseline({ better: 'higher', meaningfulChange: 2 }, 4.5, 2.25)).toEqual({
      change: -2.3,
      met: false,
    });
    expect(changeFromBaseline({ better: 'higher', meaningfulChange: null }, 4, 9)).toEqual({
      change: 5,
      met: null,
    });
  });
});

describe('the library gate', () => {
  it('lets patients fill only an instrument with items, a confirmed licence and sign-off', () => {
    const definition = fake();
    const cases = [
      [{ definition: null, licence: 'free', signedOff: false }, 'awaiting_items'],
      [{ definition, licence: 'unconfirmed', signedOff: true }, 'awaiting_licence'],
      [{ definition, licence: 'licensed', signedOff: false }, 'awaiting_sign_off'],
      [{ definition, licence: 'free', signedOff: true }, 'ready'],
    ] as const;
    for (const [entry, state] of cases) {
      expect(questionnaireState(entry), state).toBe(state);
      expect(questionnaireFillable(entry), state).toBe(state === 'ready');
    }
    expect(questionnaireSummary(cases.map(([entry]) => entry))).toBe(
      '1 of 4 questionnaires can be filled by patients.',
    );
    expect(questionnaireSummary([cases[0][0], cases[1][0]])).toBe(
      'None of the 2 questionnaires can be filled yet: each needs its items and scoring, a confirmed licence and clinical sign-off.',
    );
    expect(questionnaireSummary([cases[0][0]])).toBe(
      'The questionnaire cannot be filled yet: it needs its items and scoring, a confirmed licence and clinical sign-off.',
    );
    expect(questionnaireSummary([])).toBe('This version has no questionnaires.');
  });
});

// OUT-02: what the patient's phone sends, what is kept, and the Progress tab's line.
describe('a filled questionnaire', () => {
  it('keeps every item’s allowed answer, null for a skipped or disallowed one, and an activity’s name', () => {
    const named = questionnaireDefinitionSchema.parse({
      ...fake(),
      items: [choice('a'), choice('b'), { ...scale('c', 'activity'), max: 4 }],
      scoring: { method: 'sum', maxMissing: 0 },
      range: { min: 0, max: 12 },
    });
    const sent = questionnaireSubmissionSchema.parse({
      key: 'test_instrument',
      kbVersionId: '00000000-0000-4000-8000-0000000000b1',
      version: 'test-1',
      answers: {
        a: { value: 3 },
        b: { value: 7 },
        c: { value: 2, activity: '  Climbing stairs  ' },
        extra: { value: 1 },
      },
    });
    expect(keptAnswers(named, sent.answers)).toEqual({
      a: { value: 3 },
      b: { value: null },
      c: { value: 2, activity: 'Climbing stairs' },
    });
    // An activity rated but not named counts as missing.
    expect(keptAnswers(named, { c: { value: 3 } })).toMatchObject({ c: { value: null } });
    expect(questionnaireSubmissionSchema.safeParse({ key: 'Bad key', answers: {} }).success).toBe(
      false,
    );
  });

  it('draws its line with the meaningful change band from the baseline, the better way', () => {
    const lower = { better: 'lower' as const, meaningfulChange: 10, range: { min: 0, max: 100 } };
    const line = questionnaireLine(lower, [
      { label: '1 Oct', score: 42 },
      { label: '8 Oct', score: null },
      { label: '29 Oct', score: 30 },
    ]);
    expect(line.band).toEqual({ from: 42, to: 32, label: 'Meaningful change' });
    expect(line.sentence).toBe(
      '12 points better than the baseline; the meaningful change is 10 points, reached.',
    );
    expect(
      questionnaireLine({ ...lower, better: 'higher' }, [
        { label: 'a', score: 95 },
        { label: 'b', score: 94 },
      ]),
    ).toMatchObject({
      band: { from: 95, to: 100 },
      sentence:
        '1 point worse than the baseline; the meaningful change is 10 points, not reached yet.',
    });
    expect(
      questionnaireLine({ ...lower, meaningfulChange: null }, [
        { label: 'a', score: 20 },
        { label: 'b', score: 20 },
      ]),
    ).toEqual({
      points: [
        { label: 'a', score: 20 },
        { label: 'b', score: 20 },
      ],
      band: null,
      sentence: 'The same as the baseline; no meaningful change value yet.',
    });
    expect(questionnaireLine(lower, [{ label: 'a', score: 20 }]).sentence).toBeNull();
  });
});
