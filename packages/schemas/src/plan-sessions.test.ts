import { describe, expect, it } from 'vitest';
import { istInstant } from './ist';
import {
  bookPlanSessionsSchema,
  nearestStarts,
  planSessionsPatternSchema,
  planSessionsToBook,
  seriesDates,
  seriesRows,
  seriesStartText,
  weekdaysMessage,
} from './plan-sessions';
import type { FreeSlot, Interval, SlotQuery } from './slots';

// SCH-11 (user decisions, 26 October 2026): the plan's count less what is booked or done, capped
// by the package; weekdays from a start date; a date not free offers the nearest free times that
// day and the next day, never on another session of the series.

// Monday 2 November 2026 onwards.
const at = (date: string, minutes: number) => istInstant(date, minutes);
const span = (date: string, from: number, to: number): Interval => ({
  startsAt: at(date, from),
  endsAt: at(date, to),
});
const hours = (date: string): SlotQuery => ({
  windows: [span(date, 9 * 60, 13 * 60)],
  busy: [],
  minutes: 45,
  step: 15,
  now: istInstant('2026-11-01', 0),
});
const minutesOf = (date: string, slots: FreeSlot[]) =>
  slots.map((slot) => (slot.startsAt.getTime() - at(date, 0).getTime()) / 60000);

describe('planSessionsToBook', () => {
  it('books the plan less what is booked or done', () => {
    expect(planSessionsToBook({ planned: 12, booked: 2, done: 3, packageLeft: null })).toBe(7);
  });

  it('never books more than the package has left less what is already booked', () => {
    expect(planSessionsToBook({ planned: 12, booked: 2, done: 0, packageLeft: 8 })).toBe(6);
    expect(planSessionsToBook({ planned: 12, booked: 0, done: 0, packageLeft: 0 })).toBe(0);
  });

  it('books nothing without a frequency, and never a negative count', () => {
    expect(planSessionsToBook({ planned: null, booked: 0, done: 0, packageLeft: null })).toBe(0);
    expect(planSessionsToBook({ planned: 4, booked: 3, done: 2, packageLeft: null })).toBe(0);
  });
});

describe('seriesDates', () => {
  it('takes the ticked weekdays from the start date, across weeks and months', () => {
    expect(seriesDates('2026-11-25', [1, 3, 5], 5)).toEqual([
      '2026-11-25',
      '2026-11-27',
      '2026-11-30',
      '2026-12-02',
      '2026-12-04',
    ]);
  });

  it('skips the start date when it is not a ticked day, and gives nothing without days', () => {
    expect(seriesDates('2026-11-03', [1], 2)).toEqual(['2026-11-09', '2026-11-16']);
    expect(seriesDates('2026-11-03', [], 2)).toEqual([]);
  });
});

describe('nearestStarts', () => {
  it('keeps the nearest, earlier first on a tie, in time order', () => {
    const free = [540, 600, 660, 720].map((m) => ({
      startsAt: at('2026-11-02', m),
      endsAt: at('2026-11-02', m + 45),
      machineUnit: null,
    }));
    expect(minutesOf('2026-11-02', nearestStarts(free, at('2026-11-02', 630), 2))).toEqual([
      600, 660,
    ]);
  });
});

describe('seriesRows', () => {
  const dates = ['2026-11-02', '2026-11-03'];
  const starts = dates.map((date) => at(date, 600));

  it('passes free dates and offers the nearest times that day and the next for a clash', () => {
    const queries: Record<string, SlotQuery> = {
      '2026-11-02': { ...hours('2026-11-02'), busy: [span('2026-11-02', 570, 660)] },
      '2026-11-03': hours('2026-11-03'),
      '2026-11-04': hours('2026-11-04'),
    };
    const [monday] = seriesRows([at('2026-11-02', 600)], (d) => queries[d], 3);
    const [tuesday] = seriesRows([at('2026-11-03', 600)], (d) => queries[d], 3);
    expect(monday?.check).toEqual({ ok: false, refusal: 'taken' });
    expect(minutesOf('2026-11-02', monday?.sameDay ?? [])).toEqual([660, 675, 690]);
    expect(monday?.nextDay?.startsAt).toEqual(at('2026-11-03', 600));
    expect(tuesday?.check.ok).toBe(true);
    expect(tuesday?.sameDay).toEqual([]);
  });

  it("never offers a next day time on the series' own session that day", () => {
    const queries: Record<string, SlotQuery> = {
      '2026-11-02': { ...hours('2026-11-02'), busy: [span('2026-11-02', 540, 780)] },
      '2026-11-03': hours('2026-11-03'),
    };
    const [monday, tuesday] = seriesRows(starts, (d) => queries[d], 3);
    expect(monday?.sameDay).toEqual([]);
    // Tuesday's own 10:00 to 10:45 is taken by the series: 9:15 and 10:45 are as near; earlier.
    expect(monday?.nextDay?.startsAt).toEqual(at('2026-11-03', 555));
    expect(tuesday?.check.ok).toBe(true);
  });

  it('refuses a day without hours as outside them', () => {
    const [row] = seriesRows([at('2026-11-08', 600)], () => undefined, 3);
    expect(row?.check).toEqual({ ok: false, refusal: 'outside_hours' });
    expect(row?.nextDay).toBeNull();
  });
});

describe('the pattern', () => {
  const pattern = {
    episodeId: '00000000-0000-4000-8000-000000000501',
    fromDate: '2026-11-02',
    weekdays: ['1', '3'],
    time: '10:00',
    physioId: '00000000-0000-4000-8000-000000000207',
  };

  it('reads weekdays from the form and refuses a bad time or a repeated day', () => {
    expect(planSessionsPatternSchema.parse(pattern).weekdays).toEqual([1, 3]);
    expect(planSessionsPatternSchema.safeParse({ ...pattern, time: '25:00' }).success).toBe(false);
    expect(planSessionsPatternSchema.safeParse({ ...pattern, weekdays: ['1', '1'] }).success).toBe(
      false,
    );
    expect(planSessionsPatternSchema.safeParse({ ...pattern, weekdays: [] }).success).toBe(false);
  });

  it('needs at least one start to book, each once', () => {
    const start = at('2026-11-02', 600).toISOString();
    expect(bookPlanSessionsSchema.safeParse({ ...pattern, starts: [] }).success).toBe(false);
    expect(bookPlanSessionsSchema.safeParse({ ...pattern, starts: [start, start] }).success).toBe(
      false,
    );
    expect(bookPlanSessionsSchema.parse({ ...pattern, starts: [start] }).starts).toHaveLength(1);
  });

  it("asks for as many days as the plan's sessions a week", () => {
    expect(weekdaysMessage(2, 3)).toBe('Tick 3 days: the plan is 3 a week.');
    expect(weekdaysMessage(2, 1)).toBe('Tick 1 day: the plan is 1 a week.');
    expect(weekdaysMessage(3, 3)).toBeUndefined();
  });

  it('reads a start with its weekday', () => {
    expect(seriesStartText(at('2026-11-04', 600))).toBe('Wed 4 Nov 2026, 10:00 AM');
  });
});
