import { describe, expect, it } from 'vitest';
import {
  candidateCase,
  shortlistCandidates,
  type CandidateCase,
  type CandidateListing,
  type CandidateSettings,
} from './candidates';

// AI-02 done when: 15 to 25 rows by region, age, sex, onset, duration; matching high risk rows
// always added. Generated listings here; packages/db/src/knowledge/candidates.test.ts runs the
// real workbooks.
const settings: CandidateSettings = { min: 15, max: 25, mustRuleOutTiers: ['red_flag'] };
const knee = (n: number, extra: Partial<CandidateListing> = {}): CandidateListing => ({
  conditionId: `KNE-${String(n).padStart(3, '0')}`,
  region: 'knee',
  rowNumber: n,
  ageMin: null,
  ageMax: null,
  ageText: null,
  onsets: [],
  sex: null,
  redFlagTier: 'none',
  ...extra,
});
const many = (count: number, extra: Partial<CandidateListing> = {}, from = 1) =>
  Array.from({ length: count }, (_, i) => knee(from + i, extra));
const patient = (extra: Partial<CandidateCase> = {}): CandidateCase => ({
  region: 'knee',
  age: 30,
  sex: 'female',
  onset: 'gradual',
  durationWeeks: 6,
  activities: [],
  painZones: [],
  ...extra,
});
const ids = (list: { conditionId: string }[]) => list.map((i) => i.conditionId);

describe('the candidate filter', () => {
  it('keeps only the patient’s region, and cuts more than the most in row order', () => {
    const other: CandidateListing[] = Array.from({ length: 5 }, (_, i) => ({
      ...knee(100 + i),
      conditionId: `HIP-00${String(i)}`,
      region: 'hip',
    }));
    const result = shortlistCandidates([...many(30), ...other], patient(), settings);
    expect(result.status).toBe('ok');
    expect(result.knowledgeRegion).toBe('knee');
    expect(result.candidateCount).toBe(25);
    expect(ids(result.items)).toEqual(ids(many(25)));
  });

  it('puts stated matches first, and an age or onset mismatch last', () => {
    const rows = [
      knee(1, { ageMin: 50, ageMax: null }),
      knee(2, { onsets: ['sudden'] }),
      knee(3, { sex: 'male' }),
      knee(4),
      knee(5, { ageMin: 20, ageMax: 40, onsets: ['gradual'], sex: 'female' }),
    ];
    const result = shortlistCandidates(rows, patient(), settings);
    expect(ids(result.items)).toEqual(['KNE-005', 'KNE-004', 'KNE-003', 'KNE-002', 'KNE-001']);
    expect(result.items[0]?.fit).toEqual({ age: 'match', onset: 'match', sex: 'match' });
    expect(result.items[4]?.fit.age).toBe('mismatch');
  });

  it('fills to the fewest from the next rows, which show their mismatches', () => {
    const rows = [...many(10), ...many(20, { ageMin: 60 }, 11)];
    const result = shortlistCandidates(rows, patient(), settings);
    expect(result.candidateCount).toBe(15);
    expect(result.items.filter((i) => i.fit.age === 'mismatch')).toHaveLength(5);
  });

  it('takes the whole region when it has fewer rows than the fewest', () => {
    expect(shortlistCandidates(many(8), patient(), settings).candidateCount).toBe(8);
  });

  it('uses the most when the settings cross', () => {
    const crossed = { ...settings, min: 30, max: 20 };
    expect(shortlistCandidates(many(40), patient(), crossed).candidateCount).toBe(20);
  });

  it('never excludes on sex, and reads other, unknown and equal as neutral', () => {
    const rows = many(20, { sex: 'male' });
    expect(shortlistCandidates(rows, patient(), settings).candidateCount).toBe(20);
    for (const sex of ['other', null] as const) {
      const result = shortlistCandidates([knee(1, { sex: 'female' })], patient({ sex }), settings);
      expect(result.items[0]?.fit.sex).toBe('neutral');
    }
    const equal = shortlistCandidates([knee(1, { sex: 'equal' })], patient(), settings);
    expect(equal.items[0]?.fit.sex).toBe('neutral');
  });

  it('checks an age stated at onset against when the problem started, from the duration', () => {
    const atOnset = knee(1, { ageMax: 44, ageText: 'Under 45 at onset', redFlagTier: 'red_flag' });
    const fit = (c: Partial<CandidateCase>) =>
      shortlistCandidates([atOnset], patient(c), settings).items[0];
    // 52, with pain for 8 years: it started at 44.
    expect(fit({ age: 52, durationWeeks: 8 * 52 })).toMatchObject({
      fit: { age: 'match' },
      mustRuleOut: true,
    });
    // Without a duration the onset age is unknown: still must rule out.
    expect(fit({ age: 52, durationWeeks: null })).toMatchObject({
      fit: { age: 'unknown' },
      mustRuleOut: true,
    });
    // 52, with pain for 2 weeks: it started at 52.
    expect(fit({ age: 52, durationWeeks: 2 })?.fit.age).toBe('mismatch');
    // A plain age is the age now.
    const now = knee(1, { ageMax: 44, ageText: 'Under 45' });
    expect(
      shortlistCandidates([now], patient({ age: 52, durationWeeks: 8 * 52 }), settings).items[0]
        ?.fit.age,
    ).toBe('mismatch');
  });

  it('reads an unanswered onset, or a recurrent or subacute only row, as unknown', () => {
    const rows = [knee(1, { onsets: ['recurrent'] }), knee(2, { onsets: ['gradual'] })];
    const recurrent = shortlistCandidates(rows, patient({ onset: 'sudden' }), settings);
    expect(recurrent.items.map((i) => i.fit.onset)).toEqual(['unknown', 'mismatch']);
    const unanswered = shortlistCandidates(rows, patient({ onset: null }), settings);
    expect(unanswered.items.map((i) => i.fit.onset)).toEqual(['unknown', 'unknown']);
  });

  it('gives the same shortlist whatever order the rows come in', () => {
    const rows = [
      ...many(12),
      ...many(12, { ageMin: 50 }, 13),
      ...many(4, { redFlagTier: 'red_flag' }, 25),
    ];
    const once = shortlistCandidates(rows, patient(), settings);
    expect(shortlistCandidates(rows.toReversed(), patient(), settings)).toEqual(once);
  });

  it('has nothing without a region, and names the missing thoracic workbook', () => {
    expect(shortlistCandidates(many(20), patient({ region: null }), settings)).toEqual({
      status: 'no_region',
      knowledgeRegion: null,
      items: [],
      candidateCount: 0,
      gaps: [],
    });
    const back = shortlistCandidates(
      many(20),
      patient({ region: 'back', painZones: ['upper_back'] }),
      settings,
    );
    expect(back.gaps).toEqual(['no_thoracic_workbook']);
  });
});

describe('must rule out', () => {
  it('always adds the region’s high risk rows for the age, outside the count and never cut', () => {
    const rows = [
      ...many(30),
      knee(40, { redFlagTier: 'red_flag', onsets: ['sudden'], sex: 'male' }),
      knee(41, { redFlagTier: 'red_flag', ageMin: 60 }),
      knee(42, { redFlagTier: 'conditional' }),
    ];
    const result = shortlistCandidates(rows, patient(), settings);
    expect(result.candidateCount).toBe(25);
    expect(result.items.filter((i) => i.mustRuleOut).map((i) => i.conditionId)).toEqual([
      'KNE-040',
    ]);
    expect(result.items[0]).toMatchObject({ conditionId: 'KNE-040', filtered: false });
    expect(result.items).toHaveLength(26);
  });

  it('adds every high risk row of the region when the age is unknown', () => {
    const rows = [
      ...many(5),
      knee(40, { redFlagTier: 'red_flag', ageMin: 60 }),
      knee(41, { redFlagTier: 'red_flag', ageMax: 18 }),
    ];
    const result = shortlistCandidates(rows, patient({ age: null }), settings);
    expect(result.items.filter((i) => i.mustRuleOut)).toHaveLength(2);
  });

  it('lists a row both chosen and high risk once, with both marks', () => {
    const rows = [knee(1, { redFlagTier: 'red_flag' }), ...many(5, {}, 2)];
    const result = shortlistCandidates(rows, patient(), settings);
    expect(result.items.filter((i) => i.conditionId === 'KNE-001')).toEqual([
      expect.objectContaining({ filtered: true, mustRuleOut: true }),
    ]);
    expect(result.items).toHaveLength(6);
  });

  it('takes its tiers from the setting', () => {
    const rows = [...many(5), knee(40, { redFlagTier: 'conditional' })];
    const wider = { ...settings, mustRuleOutTiers: ['red_flag', 'conditional'] as const };
    expect(
      shortlistCandidates(rows, patient(), wider).items.filter((i) => i.mustRuleOut),
    ).toHaveLength(1);
  });
});

describe('the case from the health form', () => {
  it('reads the form first, then what is on file, and leaves unasked answers unknown', () => {
    const today = '2026-10-28';
    expect(
      candidateCase(
        {
          region: 'knee',
          date_of_birth: '1996-01-15',
          sex: 'male',
          onset: 'sudden',
          duration: 3,
          duration_unit: 'weeks',
          activities: ['running'],
          pain_site: ['knee_left_front'],
        },
        { dateOfBirth: '1980-01-01', sex: 'female', bodyRegion: 'hip' },
        today,
      ),
    ).toMatchObject({
      region: 'knee',
      age: 30,
      sex: 'male',
      onset: 'sudden',
      activities: ['running'],
      painZones: ['knee_left_front'],
    });
    expect(
      candidateCase(
        { region: 'back' },
        { dateOfBirth: '1980-01-01', sex: 'female', bodyRegion: 'back' },
        today,
      ),
    ).toEqual({
      region: 'back',
      age: 46,
      sex: 'female',
      onset: null,
      durationWeeks: null,
      activities: [],
      painZones: [],
    });
  });
});
