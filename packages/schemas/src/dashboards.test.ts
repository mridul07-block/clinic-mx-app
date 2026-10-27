import { describe, expect, it } from 'vitest';
import {
  alertItemLabels,
  alertItemLinks,
  alertItemWhere,
  alertItems,
  changeWords,
  funnelStageLabels,
  funnelStages,
  median,
  outcomeWindow,
  utilisationMinutes,
  waitMinutes,
  windowDays,
} from './dashboards';

// DSH-03: the pure parts of the Centre Manager's dashboards.
const at = (time: string) => new Date(`2026-10-28T${time}:00+05:30`);
const span = (from: string, to: string) => ({ startsAt: at(from), endsAt: at(to) });

describe('utilisation', () => {
  it('counts booked minutes inside the rostered windows only', () => {
    const windows = [span('09:00', '13:00'), span('16:00', '18:00')];
    expect(
      utilisationMinutes(windows, [
        span('09:00', '09:45'),
        // Half inside the morning: 30 of 60 minutes.
        span('12:30', '13:30'),
        // Outside every window (another centre's hours): not counted.
        span('14:00', '15:00'),
        span('16:00', '16:30'),
      ]),
    ).toEqual({ booked: 105, rostered: 360 });
    expect(utilisationMinutes([], [span('09:00', '10:00')])).toEqual({ booked: 0, rostered: 0 });
  });
});

describe('waiting', () => {
  it('counts from the later of arrival and the booked start, to the start or to now', () => {
    const now = at('10:30');
    // Arrived 10 minutes early, started 5 minutes late: waited 5.
    expect(
      waitMinutes({ startsAt: at('10:00'), arrivedAt: at('09:50'), startedAt: at('10:05') }, now),
    ).toBe(5);
    // Arrived late, started at once: no wait.
    expect(
      waitMinutes({ startsAt: at('10:00'), arrivedAt: at('10:12'), startedAt: at('10:12') }, now),
    ).toBe(0);
    // Still waiting: until now.
    expect(
      waitMinutes({ startsAt: at('10:00'), arrivedAt: at('10:02'), startedAt: null }, now),
    ).toBe(28);
  });

  it('takes the middle value', () => {
    expect(median([])).toBeNull();
    expect(median([9, 1, 5])).toBe(5);
    expect(median([4, 1, 3, 10])).toBe(3.5);
  });
});

describe('periods and words', () => {
  it('compares a window with the equal one before it', () => {
    expect(windowDays(7, '2026-10-28')).toEqual({
      current: { from: '2026-10-22', to: '2026-10-28' },
      previous: { from: '2026-10-15', to: '2026-10-21' },
    });
    expect(outcomeWindow('365')).toBe('365');
    expect(outcomeWindow('7')).toBe('90');
    expect(outcomeWindow(undefined)).toBe('90');
    expect(changeWords(12, 10)).toBe('+2 on the period before');
    expect(changeWords(8, 10, '%')).toBe('−2% on the period before');
    expect(changeWords(5, 5)).toBe('Same as the period before');
  });

  it('labels every alert count and funnel stage, and links every count to its list', () => {
    for (const item of alertItems) {
      expect(alertItemLabels[item]).toBeTruthy();
      const link = alertItemLinks[item];
      if (link === null) expect(alertItemWhere[item]).toBeTruthy();
      else expect(link).toMatch(/^\/app\//);
    }
    expect(funnelStages.map((stage) => funnelStageLabels[stage])).toHaveLength(5);
  });
});
