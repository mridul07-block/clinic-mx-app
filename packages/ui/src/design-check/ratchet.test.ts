import { describe, expect, it } from 'vitest';
import { addCounts, checkRatchet, countsTowardsRatchet, emptyCounts } from './ratchet';

describe('legacy ratchet', () => {
  it('counts native selects, date inputs and phone-width pages', () => {
    const counts = emptyCounts();
    addCounts(
      counts,
      `<main className="mx-auto max-w-signin"><select name="a" /><input type="date" />
       <select name="b"></select><div className="max-w-signin-wide" /></main>`,
    );
    expect(counts).toEqual({ 'raw-select': 2, 'raw-date-input': 1, 'phone-width-page': 1 });
  });

  it('passes when every count equals its limit', () => {
    const counts = { 'raw-select': 3, 'raw-date-input': 1, 'phone-width-page': 0 };
    expect(checkRatchet(counts, { ...counts }, 'legacy.json')).toEqual([]);
  });

  it('fails when a count rises above its limit', () => {
    const counts = { 'raw-select': 4, 'raw-date-input': 1, 'phone-width-page': 0 };
    const limits = { 'raw-select': 3, 'raw-date-input': 1, 'phone-width-page': 0 };
    const problems = checkRatchet(counts, limits, 'legacy.json');
    expect(problems.map((p) => p.rule)).toEqual(['ratchet']);
    expect(problems[0]?.message).toMatch(/^raw-select: 4 found, at most 3/);
  });

  it('asks for the limit to come down when a count falls', () => {
    const counts = { 'raw-select': 2, 'raw-date-input': 1, 'phone-width-page': 0 };
    const limits = { 'raw-select': 3, 'raw-date-input': 1, 'phone-width-page': 0 };
    expect(checkRatchet(counts, limits, 'legacy.json')[0]?.message).toBe(
      'raw-select: 2 left, lower its limit from 3 to 2',
    );
  });

  it('fails when a limit is missing', () => {
    const counts = emptyCounts();
    expect(checkRatchet(counts, { 'raw-select': 0, 'raw-date-input': 0 }, 'x')).toHaveLength(1);
  });

  it('counts screen code only', () => {
    expect(countsTowardsRatchet('apps/web/app/page.tsx')).toBe(true);
    expect(countsTowardsRatchet('apps/web/components/tag.test.tsx')).toBe(false);
    expect(countsTowardsRatchet('apps/web/e2e/today.spec.tsx')).toBe(false);
    expect(countsTowardsRatchet('apps/web/lib/a.ts')).toBe(false);
  });
});
