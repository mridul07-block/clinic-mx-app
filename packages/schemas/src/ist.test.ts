import { describe, expect, it } from 'vitest';
import { endOfIstDay, formatIstDate, istDate, istDayEndingAt } from './ist';

// Rule 15: stored in UTC, shown in IST (UTC+05:30).
describe('IST days', () => {
  it('end at midnight IST, which is 18:30 UTC the day before', () => {
    expect(endOfIstDay('2026-11-30').toISOString()).toBe('2026-11-30T18:30:00.000Z');
    expect(endOfIstDay('2026-12-31').toISOString()).toBe('2026-12-31T18:30:00.000Z');
  });

  it('give back the day they end', () => {
    expect(istDayEndingAt(endOfIstDay('2026-11-30'))).toBe('2026-11-30');
    expect(istDayEndingAt(endOfIstDay('2027-02-28'))).toBe('2027-02-28');
  });

  it('read the IST date of an instant, which can be a day ahead of UTC', () => {
    expect(istDate(new Date('2026-11-30T18:29:59Z'))).toBe('2026-11-30');
    expect(istDate(new Date('2026-11-30T18:30:00Z'))).toBe('2026-12-01');
  });

  it('format a date for people to read', () => {
    expect(formatIstDate('2026-11-30')).toBe('30 Nov 2026');
  });
});
