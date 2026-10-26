import { describe, expect, it } from 'vitest';
import { finalTestSchema, takesFinalTest } from './final-testing';

const episodeId = '00000000-0000-4000-8000-000000000501';
const quadriceps = 'knee.lsi.quadriceps'; // gitleaks:allow

// OUT-07 done when: exactly the baseline markers listed with before and after. The entries and
// their gate are the session 4 reassessment's (`./reassessment.test.ts`).
describe('final testing', () => {
  it('reads an entry per measure key and nothing else', () => {
    expect(
      finalTestSchema.parse({
        episodeId,
        entries: { [quadriceps]: { involved: 38, uninvolved: 40 } },
      }).entries,
    ).toEqual({
      [quadriceps]: {
        involved: 38,
        uninvolved: 40,
        value: null,
        notTested: false,
        reason: '',
      },
    });
    expect(finalTestSchema.safeParse({ episodeId, entries: { 'Not a key': {} } }).success).toBe(
      false,
    );
    expect(finalTestSchema.safeParse({ episodeId: 'x', entries: {} }).success).toBe(false);
  });

  it('is taken while the episode is Active or Under review only', () => {
    expect(takesFinalTest('active')).toBe(true);
    expect(takesFinalTest('under_review')).toBe(true);
    expect(takesFinalTest('plan_proposed')).toBe(false);
    expect(takesFinalTest('discharged')).toBe(false);
  });
});
