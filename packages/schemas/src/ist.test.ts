import { describe, expect, it } from 'vitest';
import {
  aroundNowToday,
  earlierToday,
  endOfIstDay,
  formatIstDate,
  formatIstDateTime,
  istDate,
  istDayEndingAt,
} from './ist';

// Rule 15: stored in UTC, shown in IST (UTC+05:30).
describe('earlierToday', () => {
  it('goes back on the same IST day, and ahead instead just after midnight', () => {
    const noon = new Date('2026-11-30T06:30:00Z'); // 12:00 IST
    expect(earlierToday(50, noon).toISOString()).toBe('2026-11-30T05:40:00.000Z');
    expect(earlierToday(-50, noon).toISOString()).toBe('2026-11-30T07:20:00.000Z');
    const afterMidnight = new Date('2026-11-30T18:50:00Z'); // 00:20 IST on 1 December
    expect(earlierToday(50, afterMidnight).toISOString()).toBe('2026-11-30T19:40:00.000Z');
    expect(istDate(earlierToday(50, afterMidnight))).toBe('2026-12-01');
  });

  it('goes back instead of ahead late in the IST day', () => {
    const lateEvening = new Date('2026-11-30T18:20:00Z'); // 23:50 IST
    expect(earlierToday(-30, lateEvening).toISOString()).toBe('2026-11-30T17:50:00.000Z');
    expect(istDate(earlierToday(-30, lateEvening))).toBe('2026-11-30');
  });

  it('keeps an offset of 12 hours or more, which means another day on purpose', () => {
    const afterMidnight = new Date('2026-11-30T18:50:00Z'); // 00:20 IST on 1 December
    expect(istDate(earlierToday(24 * 60, afterMidnight))).toBe('2026-11-30');
    expect(istDate(earlierToday(2 * 24 * 60, afterMidnight))).toBe('2026-11-29');
  });
});

describe('aroundNowToday', () => {
  it('is now plus the minutes for most of the day', () => {
    const noon = new Date('2026-11-30T06:30:00Z'); // 12:00 IST
    expect(aroundNowToday(-3, noon).toISOString()).toBe('2026-11-30T06:27:00.000Z');
  });

  it('keeps order and gaps inside today near midnight', () => {
    const afterMidnight = new Date('2026-11-30T18:35:00Z'); // 00:05 IST on 1 December
    const [before, after] = [aroundNowToday(-3, afterMidnight), aroundNowToday(3, afterMidnight)];
    expect(after.getTime() - before.getTime()).toBe(6 * 60_000);
    expect(istDate(before)).toBe('2026-12-01');
    expect(before.toISOString()).toBe('2026-11-30T19:27:00.000Z'); // 00:57 IST
    const lateEvening = new Date('2026-11-30T18:20:00Z'); // 23:50 IST
    expect(istDate(aroundNowToday(30, lateEvening))).toBe('2026-11-30');
    expect(istDate(aroundNowToday(-24 * 60, afterMidnight))).toBe('2026-11-30');
  });
});

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

  it('format an instant in IST, on a 24 hour clock', () => {
    expect(formatIstDateTime(new Date('2026-10-22T09:00:00Z'))).toBe('22 Oct 2026, 14:30 IST');
    expect(formatIstDateTime(new Date('2026-10-22T18:45:00Z'))).toBe('23 Oct 2026, 00:15 IST');
  });
});
