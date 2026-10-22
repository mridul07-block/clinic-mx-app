import { describe, expect, it } from 'vitest';
import { addDays, isoWeekday } from './ist';
import {
  blocksOnGrid,
  blocksOverlap,
  dayBlocksSchema,
  formatBlocks,
  formatLeave,
  leaveDecisionSchema,
  leaveSchema,
  leaveWindow,
  rosterSchema,
} from './rosters';

const staffUserId = '00000000-0000-4000-8000-000000000207';
const centreId = '00000000-0000-4000-8000-000000000101';
const leaveId = '00000000-0000-4000-8000-000000000701';

// SET-04 done when: managers set rosters; physios request their own leave.
describe('rosters', () => {
  it('read a day’s blocks as typed, in order', () => {
    expect(dayBlocksSchema.parse('')).toEqual([]);
    expect(dayBlocksSchema.parse(' 14:00-18:00, 09:00–13:00 ')).toEqual([
      { starts: 540, ends: 780 },
      { starts: 840, ends: 1080 },
    ]);
    expect(formatBlocks(dayBlocksSchema.parse('09:00-13:00,14:00-18:00'))).toBe(
      '09:00–13:00, 14:00–18:00',
    );
    expect(formatBlocks([])).toBe('Not working');
  });

  it('refuse blocks that are not times, end first or overlap', () => {
    for (const typed of [
      '9-13',
      '09:00',
      '09:00-13:00-14:00',
      '25:00-26:00',
      '13:00-09:00',
      '09:00-09:00',
      '09:00-13:00, 12:00-14:00',
      'mornings',
    ]) {
      expect(dayBlocksSchema.safeParse(typed).success, typed).toBe(false);
    }
  });

  it('keep times on the calendar grid', () => {
    expect(blocksOnGrid([{ starts: 540, ends: 780 }], 15)).toBe(true);
    expect(blocksOnGrid([{ starts: 545, ends: 780 }], 15)).toBe(false);
    expect(blocksOverlap([{ starts: 540, ends: 780 }], [{ starts: 770, ends: 900 }])).toBe(true);
    expect(blocksOverlap([{ starts: 540, ends: 780 }], [{ starts: 780, ends: 900 }])).toBe(false);
  });

  it('take a week from a date for a person at a centre', () => {
    const week = ['09:00-13:00', '', '', '', '', '', ''];
    expect(
      rosterSchema.parse({ staffUserId, centreId, effectiveFrom: '2026-10-26', days: week })
        .days[0],
    ).toEqual([{ starts: 540, ends: 780 }]);
    expect(
      rosterSchema.safeParse({
        staffUserId,
        centreId,
        effectiveFrom: '2026-10-26',
        days: week.slice(1),
      }).success,
    ).toBe(false);
    expect(isoWeekday('2026-10-26')).toBe(1);
    expect(isoWeekday('2026-11-01')).toBe(7);
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });
});

describe('leave', () => {
  it('runs whole days from IST midnight to IST midnight', () => {
    const leave = leaveSchema.parse({
      kind: 'days',
      from: '2026-10-26',
      to: '2026-10-27',
      note: '',
    });
    expect(leaveWindow(leave)).toEqual({
      startsAt: new Date('2026-10-25T18:30:00Z'),
      endsAt: new Date('2026-10-27T18:30:00Z'),
      allDay: true,
    });
    const { startsAt, endsAt, allDay } = leaveWindow(leave);
    expect(formatLeave(startsAt, endsAt, allDay)).toBe('26 Oct 2026 to 27 Oct 2026');
    const one = leaveWindow(
      leaveSchema.parse({ kind: 'days', from: '2026-10-26', to: '2026-10-26', note: '' }),
    );
    expect(formatLeave(one.startsAt, one.endsAt, one.allDay)).toBe('26 Oct 2026');
  });

  it('runs part of a day between IST times', () => {
    const leave = leaveSchema.parse({
      kind: 'part',
      date: '2026-10-26',
      fromTime: '14:00',
      toTime: '16:00',
      note: ' Doctor ',
    });
    expect(leave.note).toBe('Doctor');
    const window = leaveWindow(leave);
    expect(window).toEqual({
      startsAt: new Date('2026-10-26T08:30:00Z'),
      endsAt: new Date('2026-10-26T10:30:00Z'),
      allDay: false,
    });
    expect(formatLeave(window.startsAt, window.endsAt, window.allDay)).toBe(
      '26 Oct 2026, 14:00–16:00',
    );
  });

  it('refuses leave that ends before it starts, bad times and no kind', () => {
    for (const bad of [
      { kind: 'days', from: '2026-10-27', to: '2026-10-26', note: '' },
      { kind: 'part', date: '2026-10-26', fromTime: '16:00', toTime: '14:00', note: '' },
      { kind: 'part', date: '2026-10-26', fromTime: '2pm', toTime: '16:00', note: '' },
      { kind: 'days', from: '', to: '2026-10-26', note: '' },
      { kind: '', note: '' },
    ]) {
      expect(leaveSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });

  it('needs a reason to decline', () => {
    expect(
      leaveDecisionSchema.safeParse({ leaveId, decision: 'approve', reason: '' }).success,
    ).toBe(true);
    expect(
      leaveDecisionSchema.safeParse({ leaveId, decision: 'decline', reason: ' ' }).success,
    ).toBe(false);
    expect(
      leaveDecisionSchema.parse({ leaveId, decision: 'decline', reason: 'Clinic short staffed' })
        .reason,
    ).toBe('Clinic short staffed');
  });
});
