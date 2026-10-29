import { describe, expect, it } from 'vitest';
import { istInstant } from './ist';
import { myPlanSchema, packageLine, planWeek } from './my-plan';

// PAT-01: the week of the plan from the day it was made (IST), the package's last day, and the
// page's content as internal.my_plan() returns it.
describe('My plan', () => {
  it('counts the week of the plan from the day it was made, and stops at its length', () => {
    const made = istInstant('2026-10-01', 18 * 60);
    expect(planWeek(made, 6, istInstant('2026-10-01', 23 * 60))).toBe('Week 1 of 6');
    expect(planWeek(made, 6, istInstant('2026-10-08', 9 * 60))).toBe('Week 2 of 6');
    expect(planWeek(made, 6, istInstant('2026-12-31', 9 * 60))).toBe('Week 6 of 6');
    expect(planWeek(made, null, istInstant('2026-10-20', 9 * 60))).toBe('Week 3');
  });

  it('words the package in its state: active, used up or expired', () => {
    const held = { total: 10, used: 4, validUntil: '2027-01-31', reschedulesLeft: 1 };
    expect(packageLine(held, '2027-01-31')).toBe('Valid until 31 Jan 2027 · 1 reschedule left');
    expect(packageLine({ ...held, reschedulesLeft: 2 }, '2026-12-01')).toBe(
      'Valid until 31 Jan 2027 · 2 reschedules left',
    );
    expect(packageLine({ ...held, used: 10 }, '2027-02-01')).toBe('All sessions used');
    expect(packageLine(held, '2027-02-01')).toBe('Expired on 31 Jan 2027 with 6 sessions unused');
    expect(packageLine({ ...held, used: 9 }, '2027-02-01')).toBe(
      'Expired on 31 Jan 2027 with 1 session unused',
    );
  });

  it('reads the page as the database gives it, and refuses a pain outside 0 to 10', () => {
    const page = {
      name: 'Test Patient',
      episodeStatus: 'active',
      centrePhone: '+91 80 0000 0000',
      plan: {
        homeProgramme: [{ exercise: 'Step downs', dose: '3 x 10', note: '' }],
        weeks: 6,
        sessionsPerWeek: 2,
        since: '2026-10-01T12:30:00+00:00',
      },
      next: null,
      package: null,
      pain: [{ number: 1, signedAt: '2026-10-03T05:00:00+00:00', rest: 2, activity: 6, after: 1 }],
      today: '2026-10-04',
      tickedToday: [0],
      tickedDays: ['2026-10-02', '2026-10-04'],
      trackedFrom: '2026-10-01',
      maintenance: null,
      // CLN-08: the approved explanation of the diagnosis, as written.
      aboutCondition: 'Test explanation in plain words.',
    };
    expect(myPlanSchema.parse(page)).toEqual(page);
    expect(
      myPlanSchema.safeParse({ ...page, pain: [{ ...page.pain[0], activity: 11 }] }).success,
    ).toBe(false);
  });
});
