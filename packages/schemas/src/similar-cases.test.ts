import { describe, expect, it } from 'vitest';
import { aiRankInputSchema, aiSimilarCaseSchema } from './ai-gateway';
import type { CandidateCase } from './candidates';
import { similarCases, type SimilarCandidate } from './similar-cases';

// AI-05: similar confirmed cases are chosen by what the forms state, never weighted, and leave as
// structured fields only (DECISION AI-05).
const base: CandidateCase = {
  region: 'knee',
  age: 34,
  sex: 'female',
  onset: 'gradual',
  durationWeeks: 6,
  activities: ['running', 'cycling'],
  painZones: ['knee_front_right'],
};
const current = { case: base, patientId: 'patient-0', episodeId: 'episode-0' };
let count = 0;
const past = (
  extra: Partial<CandidateCase> = {},
  more: Partial<Omit<SimilarCandidate, 'case'>> = {},
): SimilarCandidate => {
  count += 1;
  return {
    episodeId: ['episode', String(count).padStart(3, '0')].join('-'),
    patientId: ['patient', String(count)].join('-'),
    case: { ...base, ...extra },
    conditionId: 'KNE-004',
    conditionName: 'Fake Tendinopathy',
    confirmedAt: new Date('2026-10-01T00:00:00Z'),
    ...more,
  };
};
const settings = {
  min: 3,
  max: 5,
  stage: { acuteWeeksBelow: 3, chronicWeeksAbove: 12 },
};
const order = (pool: SimilarCandidate[]) =>
  similarCases(current, pool, [], { ...settings, min: 1 }).map((c) => c.age);

describe('similar confirmed cases', () => {
  it('come only from the same region, other patients and other episodes', () => {
    const pool = [
      past({}, { patientId: 'patient-0' }),
      past({}, { episodeId: 'episode-0' }),
      past({ region: 'shoulder' }),
      past({ age: 40 }),
      past({ age: 41 }),
      past({ age: 42 }),
    ];
    expect(similarCases(current, pool, [], settings).map((c) => c.age)).toEqual([40, 41, 42]);
  });

  it('are none when fewer than the minimum, and at most the maximum', () => {
    expect(similarCases(current, [past(), past()], [], settings)).toEqual([]);
    expect(
      similarCases(
        current,
        Array.from({ length: 9 }, () => past()),
        [],
        settings,
      ),
    ).toHaveLength(5);
    expect(
      similarCases({ ...current, case: { ...base, region: null } }, [past()], [], settings),
    ).toEqual([]);
  });

  it('are ordered by onset, stage, pain zones, sex, age, activities, then the latest confirmed', () => {
    // Each pair differs in one step only; the first of each pair comes first.
    expect(order([past({ age: 1, onset: 'sudden' }), past({ age: 2 })])).toEqual([2, 1]);
    expect(
      order([past({ age: 3, durationWeeks: 20 }), past({ age: 4, durationWeeks: 5 })]),
    ).toEqual([4, 3]);
    expect(order([past({ age: 5, painZones: [] }), past({ age: 6 })])).toEqual([6, 5]);
    expect(order([past({ age: 7, sex: 'male' }), past({ age: 8 })])).toEqual([8, 7]);
    expect(order([past({ age: 60 }), past({ age: 30 })])).toEqual([30, 60]);
    expect(order([past({ age: 9, activities: [] }), past({ age: 9 })])).toHaveLength(2);
    const [fewer, more] = [past({ age: 34, activities: [] }), past({ age: 34 })];
    expect(similarCases(current, [fewer, more], [], { ...settings, min: 1 })[0]?.sport).toEqual([
      'Running',
      'Cycling',
    ]);
    const older = past({ age: 50 }, { confirmedAt: new Date('2026-01-01T00:00:00Z') });
    const newer = past({ age: 51 }, { confirmedAt: new Date('2026-10-20T00:00:00Z') });
    // Age first: 50 is nearer; with equal ages the later confirmation wins.
    expect(order([older, newer])).toEqual([50, 51]);
    expect(
      order([
        past({ age: 40 }, { confirmedAt: new Date('2026-01-01T00:00:00Z') }),
        past({ age: 28 }, { confirmedAt: new Date('2026-10-20T00:00:00Z') }),
      ]),
    ).toEqual([28, 40]);
  });

  it('count unknown answers as neither like nor unlike', () => {
    const unknown = { ...current, case: { ...base, onset: null, sex: null, durationWeeks: null } };
    const pool = [past({ age: 35, onset: 'sudden', sex: 'male' }), past({ age: 36 })];
    expect(similarCases(unknown, pool, [], { ...settings, min: 1 }).map((c) => c.age)).toEqual([
      35, 36,
    ]);
  });

  it('count a past case’s unknown onset, stage and sex as neutral, and an unknown age last', () => {
    // An unknown onset, duration or sex ties with a match; a stated mismatch comes after.
    const neutral = past({ age: 34, onset: null, durationWeeks: null, sex: null });
    const unlike = past({ age: 34, onset: 'sudden' });
    expect(similarCases(current, [unlike, neutral], [], { ...settings, min: 1 })[0]).toMatchObject({
      durationWeeks: null,
      sex: null,
    });
    // Any known age, however far, comes before an unknown one.
    expect(order([past({ age: null }), past({ age: 90 })])).toEqual([90, null]);
  });

  it('skip a case the guard refuses for the next one, before the cut', () => {
    const pool = [1, 2, 3, 4, 5, 6, 7].map((n) =>
      past({ age: 30 + n }, { conditionName: n <= 3 ? 'Refused name' : 'Fine name' }),
    );
    const sent = similarCases(current, pool, [], {
      ...settings,
      allowed: (c) => c.confirmed !== 'Refused name',
    });
    expect(sent.map((c) => c.age)).toEqual([34, 35, 36, 37]);
  });

  it('send structured fields and the shortlist row, never an ID, date or free text', () => {
    const [sent] = similarCases(
      current,
      [past({ age: 200, durationWeeks: 9999 }), past(), past()],
      [{ conditionId: 'KNE-001' }, { conditionId: 'KNE-004' }],
      settings,
    );
    expect(Object.keys(sent ?? {}).sort()).toEqual(
      ['age', 'confirmed', 'durationWeeks', 'n', 'region', 'sex', 'sport', 'symptoms'].sort(),
    );
    expect(sent).toMatchObject({ confirmed: 'Fake Tendinopathy', n: 2, region: 'knee' });
    expect(
      JSON.stringify(similarCases(current, [past(), past(), past()], [], settings)),
    ).not.toMatch(/episode-|patient-|2026/);
    const wild = similarCases(
      current,
      [past({ age: 200, durationWeeks: 9999 }), past(), past()],
      [],
      {
        ...settings,
      },
    ).find((c) => c.age === null);
    expect(wild?.durationWeeks).toBeNull();
    expect(aiSimilarCaseSchema.safeParse({ ...sent, episodeId: 'episode-1' }).success).toBe(false);
    expect(aiSimilarCaseSchema.safeParse({ ...sent, confirmedAt: '2026-10-01' }).success).toBe(
      false,
    );
    // A rank input without similar cases still parses (prompts that are not told about them).
    expect(aiRankInputSchema.shape.similar.safeParse(undefined).success).toBe(true);
  });
});
