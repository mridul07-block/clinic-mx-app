import { z } from 'zod';
import {
  calendarDateSchema,
  endOfIstDay,
  formatIstDate,
  istDate,
  istDayEndingAt,
  istInstant,
  startOfIstDay,
  timeText,
} from './ist';

/**
 * Rosters and leave (SET-04, PRD M2 "physio availability and leave"). Decisions (user, 22 October
 * 2026):
 * - a roster is a weekly pattern per person per centre, with several blocks a day (gaps are
 *   breaks), in effect from a chosen date; earlier weeks keep the pattern they had;
 * - leave is whole days, or part of one day; a person requests it and their Centre Manager or the
 *   Super Admin decides; managers may record it directly; nobody approves their own.
 * Times of day are IST wall clock times, as minutes after midnight; leave is stored as UTC
 * instants (rule 15). Times sit on the calendar grid (`scheduling.slot_minutes`), checked in the
 * service because the slot is a setting.
 */

/** A working block: minutes after midnight IST, from `starts` to `ends`. */
export interface Block {
  starts: number;
  ends: number;
}

/** A week of blocks, Monday first (index 0) to Sunday (index 6). */
export type Weekly = Block[][];

export const weekdayNames = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
] as const;

const timePattern = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** A 24 hour time of day, "HH:MM", as minutes after midnight; undefined when it is not one. */
export function parseTime(text: string): number | undefined {
  const match = timePattern.exec(text.trim());
  if (!match) return undefined;
  return Number(match[1]) * 60 + Number(match[2]);
}

const blocksMessage = 'Write times as 09:00-13:00, with a comma between blocks.';

/**
 * One day's blocks as typed, for example "09:00-13:00, 14:00-18:00"; blank means not working.
 * Blocks come back in order and must neither be empty nor overlap.
 */
export const dayBlocksSchema = z
  .string()
  .trim()
  .transform((text, context): Block[] => {
    if (text === '') return [];
    const blocks: Block[] = [];
    for (const part of text.split(',')) {
      const [from = '', to = '', extra] = part.split(/[-–]/);
      const starts = parseTime(from);
      const ends = parseTime(to);
      if (extra !== undefined || starts === undefined || ends === undefined) {
        context.addIssue({ code: 'custom', message: blocksMessage });
        return z.NEVER;
      }
      if (ends <= starts) {
        context.addIssue({ code: 'custom', message: 'Each block must end after it starts.' });
        return z.NEVER;
      }
      blocks.push({ starts, ends });
    }
    blocks.sort((a, b) => a.starts - b.starts);
    if (blocks.some((block, i) => i > 0 && block.starts < (blocks[i - 1]?.ends ?? 0))) {
      context.addIssue({ code: 'custom', message: 'Blocks on one day must not overlap.' });
      return z.NEVER;
    }
    return blocks;
  });

/** Blocks as people read them: "09:00–13:00, 14:00–18:00", or "Not working". */
export function formatBlocks(blocks: Block[]): string {
  if (blocks.length === 0) return 'Not working';
  return blocks.map((b) => `${timeText(b.starts)}–${timeText(b.ends)}`).join(', ');
}

/** Whether every time is a whole number of slots after midnight. */
export function blocksOnGrid(blocks: Block[], slotMinutes: number): boolean {
  return blocks.every((b) => b.starts % slotMinutes === 0 && b.ends % slotMinutes === 0);
}

/** Whether two days' blocks share any minute. */
export function blocksOverlap(a: Block[], b: Block[]): boolean {
  return a.some((x) => b.some((y) => x.starts < y.ends && y.starts < x.ends));
}

/** A roster version as entered: who, where, from when, and a field per weekday. */
export const rosterSchema = z.object({
  staffUserId: z.guid(),
  centreId: z.guid({ error: 'Choose the centre.' }),
  effectiveFrom: calendarDateSchema,
  days: z.array(dayBlocksSchema).length(7),
});

export type RosterInput = z.output<typeof rosterSchema>;

const note = z
  .string()
  .trim()
  .max(200, { error: 'Keep the note under 200 characters.' })
  .transform((text) => (text === '' ? null : text));

const time = (what: string) =>
  z
    .string()
    .trim()
    .refine((text) => parseTime(text) !== undefined, {
      error: `Enter the ${what} time as 24 hour HH:MM, for example 14:00.`,
    })
    .transform((text) => parseTime(text) ?? 0);

/** Leave as entered: whole days from a date to a date, or part of one day. */
export const leaveSchema = z.discriminatedUnion(
  'kind',
  [
    z
      .object({ kind: z.literal('days'), from: calendarDateSchema, to: calendarDateSchema, note })
      .refine((leave) => leave.to >= leave.from, {
        error: 'The last day cannot be before the first.',
        path: ['to'],
      }),
    z
      .object({
        kind: z.literal('part'),
        date: calendarDateSchema,
        fromTime: time('from'),
        toTime: time('to'),
        note,
      })
      .refine((leave) => leave.toTime > leave.fromTime, {
        error: 'The leave must end after it starts.',
        path: ['toTime'],
      }),
  ],
  { error: 'Choose whole days or part of a day.' },
);

export type LeaveInput = z.output<typeof leaveSchema>;

/** Leave for a person: who, and the leave. */
export const personLeaveSchema = z.object({ staffUserId: z.guid() }).and(leaveSchema);

/** The UTC instants leave runs between; whole days run from IST midnight to IST midnight. */
export function leaveWindow(leave: LeaveInput): {
  startsAt: Date;
  endsAt: Date;
  allDay: boolean;
} {
  return leave.kind === 'days'
    ? { startsAt: startOfIstDay(leave.from), endsAt: endOfIstDay(leave.to), allDay: true }
    : {
        startsAt: istInstant(leave.date, leave.fromTime),
        endsAt: istInstant(leave.date, leave.toTime),
        allDay: false,
      };
}

/** The first IST date leave touches, for "starts today or later". */
export const leaveFirstDay = (leave: LeaveInput) =>
  leave.kind === 'days' ? leave.from : leave.date;

/** Leave as people read it: "24 Oct 2026", "24 Oct 2026 to 26 Oct 2026", "24 Oct 2026, 14:00–16:00". */
export function formatLeave(startsAt: Date, endsAt: Date, allDay: boolean): string {
  const first = istDate(startsAt);
  if (allDay) {
    const last = istDayEndingAt(endsAt);
    return first === last
      ? formatIstDate(first)
      : `${formatIstDate(first)} to ${formatIstDate(last)}`;
  }
  const minutes = (instant: Date) =>
    Math.round((instant.getTime() - startOfIstDay(first).getTime()) / 60000);
  return `${formatIstDate(first)}, ${timeText(minutes(startsAt))}–${timeText(minutes(endsAt))}`;
}

/** A manager's decision on requested leave; a decline needs a reason the person will see. */
export const leaveDecisionSchema = z
  .object({
    leaveId: z.guid(),
    decision: z.enum(['approve', 'decline']),
    reason: z
      .string()
      .trim()
      .max(200, { error: 'Keep the reason under 200 characters.' })
      .transform((text) => (text === '' ? null : text)),
  })
  .refine((decision) => decision.decision === 'approve' || decision.reason !== null, {
    error: 'Say why the leave is declined.',
    path: ['reason'],
  });

export const leaveCancelSchema = z.object({ leaveId: z.guid() });
