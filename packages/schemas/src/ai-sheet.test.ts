import { describe, expect, it } from 'vitest';
import { aiCaseSchema } from './ai-gateway';
import { aiCaseFrom, durationLabel, knowledgeSource, validateRanking } from './ai-sheet';
import type { CandidateCase, ShortlistItem } from './candidates';

// AI-03 done when: unknown IDs dropped; knowledge base text shown word for word; Keep and Dismiss
// stored; ready within 15 s. Here: the validation and the case sent.
const item = (n: number, extra: Partial<ShortlistItem> = {}): ShortlistItem => ({
  conditionId: `KNE-${String(n).padStart(3, '0')}`,
  region: 'knee',
  rowNumber: n,
  fit: { age: 'match', onset: 'unknown', sex: 'neutral' },
  filtered: true,
  mustRuleOut: false,
  ...extra,
});
const items = Array.from({ length: 9 }, (_, i) => item(i + 1));
const counts = { top: 3, alsoConsider: 2 };
const reason = (n: number) => ({ n, reason: `Reason ${String(n)}` });

describe('validating the ranking', () => {
  it('drops numbers not on the shortlist and repeated conditions, keeping the first place', () => {
    const shared = [item(1), item(2, { conditionId: 'KNE-001', rowNumber: 7 }), item(3)];
    const result = validateRanking(
      shared,
      [reason(0), reason(9), reason(2), reason(1), reason(3)],
      counts,
    );
    expect(result.map((s) => [s.conditionId, s.rowNumber, s.rank])).toEqual([
      ['KNE-001', 7, 1],
      ['KNE-003', 3, 2],
    ]);
  });

  it('keeps the top and Also consider counts, ranked from 1', () => {
    const result = validateRanking(items, [9, 8, 7, 6, 5, 4, 3].map(reason), counts);
    expect(result.map((s) => [s.conditionId, s.rank, s.section])).toEqual([
      ['KNE-009', 1, 'top'],
      ['KNE-008', 2, 'top'],
      ['KNE-007', 3, 'top'],
      ['KNE-006', 4, 'also_consider'],
      ['KNE-005', 5, 'also_consider'],
    ]);
    expect(result[0]?.reason).toBe('Reason 9');
  });

  it('never adds a suggestion the model did not rank', () => {
    expect(validateRanking(items, [reason(4), reason(2)], counts).map((s) => s.section)).toEqual([
      'top',
      'top',
    ]);
    expect(validateRanking(items, [reason(42)], counts)).toEqual([]);
    expect(validateRanking(items, [{ n: 1.5, reason: 'x' }], counts)).toEqual([]);
  });
});

describe('the case sent to the model', () => {
  const c: CandidateCase = {
    region: 'knee',
    age: 34,
    sex: 'female',
    onset: 'gradual',
    durationWeeks: 6.14,
    activities: ['running'],
    painZones: ['left_knee_front'],
  };

  it('holds only the TAD’s fields, from the form’s own words, each cut to 200 characters', () => {
    const sent = aiCaseFrom(c, {
      region: 'knee',
      pain_site: ['left_knee_front'],
      complaint: 'Pain on stairs',
      how_started: 'x'.repeat(300),
      aggravating: 'Squatting',
      easing: '',
      activities: ['running', 'other', 'not_active'],
      activity_other: 'Kabaddi',
      goals: 'Run a 10 km race',
      occupation: 'Test occupation',
      medicines: 'Test medicine',
    });
    expect(sent).not.toBeNull();
    expect(aiCaseSchema.parse(sent)).toEqual(sent);
    expect(sent?.symptoms).toEqual([
      'Left knee, front',
      'Pain on stairs',
      'x'.repeat(200),
      'Squatting',
    ]);
    expect(sent?.sport).toEqual(['Running', 'Kabaddi']);
    expect(sent?.goal).toBe('Run a 10 km race');
    expect(sent?.durationWeeks).toBe(6.1);
    expect(JSON.stringify(sent)).not.toMatch(/occupation|medicine/i);
  });

  it('sends a mistyped age or an impossible duration as unknown', () => {
    expect(aiCaseFrom({ ...c, age: 124, durationWeeks: 99999 }, {})).toMatchObject({
      age: null,
      durationWeeks: null,
    });
  });

  it('reads a duration as days under a week, else whole weeks', () => {
    expect([0.4, 1 / 7, 1, 6.14, 52].map(durationLabel)).toEqual([
      '3 days',
      '1 day',
      '1 week',
      '6 weeks',
      '52 weeks',
    ]);
  });

  it('is nothing without a region', () => {
    expect(aiCaseFrom({ ...c, region: null }, {})).toBeNull();
  });

  it('names the knowledge base row it came from', () => {
    expect(knowledgeSource({ conditionId: 'KNE-004', region: 'knee', rowNumber: 6 }, 3)).toBe(
      'Knowledge base version 3 · Knee row 6 · KNE-004',
    );
  });
});
