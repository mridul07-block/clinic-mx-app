import { describe, expect, it } from 'vitest';
import { adherenceLine, planWeekStart, weekStripDays } from './adherence';
import { istInstant } from './ist';

// PAT-02: the session note's adherence line in plain words, and the week strip's days.
describe('Adherence', () => {
  const snapshot = {
    from: '2026-10-21',
    to: '2026-10-27',
    since: 'last_session' as const,
    days: 7,
    daysDone: 5,
    tracked: true,
  };

  it('words the days done since the last session, or the plan, as a count', () => {
    expect(adherenceLine(snapshot)).toBe(
      'Home exercises ticked on My plan: 5 of 7 days since the last session (21 Oct 2026 to 27 Oct 2026).',
    );
    expect(adherenceLine({ ...snapshot, since: 'plan' })).toContain('since the plan was made');
    expect(adherenceLine({ ...snapshot, days: 0, daysDone: 0 })).toBe(
      'Home exercises: no days since the last session.',
    );
    // No days at all says so, whether or not a link existed yet.
    expect(adherenceLine({ ...snapshot, days: 0, daysDone: 0, tracked: false })).toBe(
      'Home exercises: no days since the last session.',
    );
    expect(adherenceLine({ ...snapshot, tracked: false })).toBe(
      'Home exercises: not tracked, as the patient had no My plan link yet.',
    );
  });

  it('marks the week’s days done, missed or still to come', () => {
    const days = weekStripDays(
      '2026-10-22',
      ['2026-10-22', '2026-10-24', '2026-10-28'],
      '2026-10-28',
      '2026-10-20',
    );
    expect(days.map((day) => day.state)).toEqual([
      'done',
      'missed',
      'done',
      'missed',
      'missed',
      'missed',
      'done',
    ]);
    expect(days[0]).toEqual({ day: 'Thu', date: '22 Oct', state: 'done' });
    // Today not yet ticked, and the days after: still to come.
    expect(
      weekStripDays('2026-10-26', [], '2026-10-28', '2026-10-20').map((day) => day.state),
    ).toEqual(['missed', 'missed', 'to_come', 'to_come', 'to_come', 'to_come', 'to_come']);
    // Before the patient could tick (a plan and a My plan link), or without both: not tracked.
    expect(
      weekStripDays('2026-10-22', [], '2026-10-28', '2026-10-27').map((day) => day.state),
    ).toEqual([
      'not_tracked',
      'not_tracked',
      'not_tracked',
      'not_tracked',
      'not_tracked',
      'missed',
      'to_come',
    ]);
    expect(
      weekStripDays('2026-10-22', [], '2026-10-28', null).every(
        (day) => day.state === 'not_tracked',
      ),
    ).toBe(true);
  });

  it('starts the plan week on the plan’s own weekday in IST', () => {
    // Made late on 21 October in IST, which is still the afternoon of the 21st in UTC.
    const made = istInstant('2026-10-21', 22 * 60);
    expect(planWeekStart(made, '2026-10-21')).toBe('2026-10-21');
    expect(planWeekStart(made, '2026-10-27')).toBe('2026-10-21');
    expect(planWeekStart(made, '2026-10-28')).toBe('2026-10-28');
    expect(planWeekStart(made, '2026-11-05')).toBe('2026-11-04');
  });
});
