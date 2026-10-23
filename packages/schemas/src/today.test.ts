import { describe, expect, it } from 'vitest';
import { istInstant } from './ist';
import { appointmentStatuses } from './slots';
import { canCheckIn, inTodayFilter, todayGroup } from './today';

// INT-01: the Today board's chips, and checking in on the appointment's own IST day.
describe('today board', () => {
  it('puts each status under one chip, leaving cancelled and rescheduled off', () => {
    expect(Object.fromEntries(appointmentStatuses.map((s) => [s, todayGroup(s)]))).toEqual({
      booked: 'to_arrive',
      confirmed: 'to_arrive',
      checked_in: 'here',
      in_progress: 'with_physio',
      completed: 'done',
      no_show: 'done',
      cancelled: undefined,
      rescheduled: undefined,
    });
  });

  it('filters Not confirmed to Booked, and All to what is on the board', () => {
    expect(appointmentStatuses.filter((s) => inTodayFilter(s, 'not_confirmed'))).toEqual([
      'booked',
    ]);
    expect(appointmentStatuses.filter((s) => inTodayFilter(s, undefined))).not.toContain(
      'cancelled',
    );
    expect(appointmentStatuses.filter((s) => inTodayFilter(s, 'done'))).toEqual([
      'completed',
      'no_show',
    ]);
  });

  it('checks in on the appointment’s day in IST only', () => {
    const start = istInstant('2026-11-02', 600);
    expect(canCheckIn(start, istInstant('2026-11-02', 0))).toBe(true);
    expect(canCheckIn(start, istInstant('2026-11-02', 24 * 60 - 1))).toBe(true);
    expect(canCheckIn(start, istInstant('2026-11-03', 0))).toBe(false);
    expect(canCheckIn(start, istInstant('2026-11-01', 24 * 60 - 1))).toBe(false);
  });
});
