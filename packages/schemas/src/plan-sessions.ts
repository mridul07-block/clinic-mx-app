import { z } from 'zod';
import {
  addDays,
  calendarDateSchema,
  documentDate,
  documentTime,
  istDate,
  isoWeekday,
} from './ist';
import { parseTime, weekdayNames } from './rosters';
import {
  checkSlot,
  slotStarts,
  type FreeSlot,
  type Interval,
  type SlotCheck,
  type SlotQuery,
  type SlotRefusal,
} from './slots';

/**
 * Book plan sessions (SCH-11, PRD J4.8): once the episode is Active, the front desk books the
 * plan's remaining sessions at once from a weekly pattern (a start date, the plan's sessions a week
 * as weekdays, one time, a physio). A date that is not free shows why, the nearest free starts
 * that day with the same physio and the nearest the next day, or is skipped. User decisions, 26
 * October 2026.
 */

/** Sessions already in the episode, and what the plan and any package allow. */
export interface PlanSessionCounts {
  /** Sessions a week × weeks from the plan; null when the plan sets no frequency. */
  planned: number | null;
  /** Session appointments booked and not yet done (booked, confirmed, checked in, in progress). */
  booked: number;
  /** Session appointments completed. */
  done: number;
  /** With a package bought: its sessions left; null for pay per session. */
  packageLeft: number | null;
}

/**
 * How many sessions "Book plan sessions" books: the plan's count less those booked or done, and
 * with a package never more than its sessions left less those already booked.
 */
export function planSessionsToBook(counts: PlanSessionCounts): number {
  if (counts.planned === null) return 0;
  const byPlan = counts.planned - counts.booked - counts.done;
  const byPackage =
    counts.packageLeft === null ? Number.POSITIVE_INFINITY : counts.packageLeft - counts.booked;
  return Math.max(0, Math.min(byPlan, byPackage));
}

/** The first `count` IST dates from `fromDate` (itself included) on the ISO weekdays given. */
export function seriesDates(
  fromDate: string,
  weekdays: readonly number[],
  count: number,
): string[] {
  const days = new Set(weekdays);
  const dates: string[] = [];
  if (days.size === 0) return dates;
  for (let date = fromDate; dates.length < count; date = addDays(date, 1)) {
    if (days.has(isoWeekday(date))) dates.push(date);
  }
  return dates;
}

/** Up to `count` free starts nearest to `target` (earlier first on a tie), in time order. */
export function nearestStarts(free: readonly FreeSlot[], target: Date, count: number): FreeSlot[] {
  const distance = (slot: FreeSlot) => Math.abs(slot.startsAt.getTime() - target.getTime());
  return [...free]
    .sort((a, b) => distance(a) - distance(b) || a.startsAt.getTime() - b.startsAt.getTime())
    .slice(0, count)
    .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
}

/** One date of the series: the asked start, whether it is free, and what to offer when not. */
export interface SeriesRow {
  startsAt: Date;
  check: SlotCheck;
  /** When it is not free: the nearest free starts that day with the same physio. */
  sameDay: FreeSlot[];
  /** When it is not free: the nearest free start the next day at about the same time. */
  nextDay: FreeSlot | null;
}

/**
 * Checks each start of a series with the slot engine's rules. `queryOn` gives the physio's rules
 * for a date (undefined: no hours there). The series' own starts count as busy for the
 * alternatives, so a next day choice never lands on another session of the series.
 */
export function seriesRows(
  starts: readonly Date[],
  queryOn: (date: string) => SlotQuery | undefined,
  alternatives: number,
): SeriesRow[] {
  const series: Interval[] = starts.flatMap((startsAt) => {
    const query = queryOn(istDate(startsAt));
    return query
      ? [{ startsAt, endsAt: new Date(startsAt.getTime() + query.minutes * 60_000) }]
      : [];
  });
  const freeOn = (date: string, except: Date) => {
    const query = queryOn(date);
    if (!query) return [];
    const others = series.filter((s) => s.startsAt.getTime() !== except.getTime());
    return slotStarts({ ...query, busy: [...query.busy, ...others] });
  };
  return starts.map((startsAt) => {
    const date = istDate(startsAt);
    const query = queryOn(date);
    const check: SlotCheck = query
      ? checkSlot(query, startsAt)
      : { ok: false, refusal: 'outside_hours' };
    if (check.ok) return { startsAt, check, sameDay: [], nextDay: null };
    const next = addDays(date, 1);
    const sameTimeNextDay = new Date(startsAt.getTime() + 24 * 60 * 60_000);
    return {
      startsAt,
      check,
      sameDay: nearestStarts(freeOn(date, startsAt), startsAt, alternatives),
      nextDay: nearestStarts(freeOn(next, startsAt), sameTimeNextDay, 1).at(0) ?? null,
    };
  });
}

const timeSchema = z
  .string()
  .refine((text) => parseTime(text) !== undefined, { error: 'Enter a time.' });

/** The weekly pattern the desk sets: checked against the plan's sessions a week by the service. */
export const planSessionsPatternSchema = z.object({
  episodeId: z.guid(),
  fromDate: calendarDateSchema,
  weekdays: z
    .array(z.coerce.number().pipe(z.int().min(1).max(7)))
    .min(1, { error: 'Tick the days of the week.' })
    .refine((days) => new Set(days).size === days.length, { error: 'Tick each day once.' }),
  time: timeSchema,
  physioId: z.guid({ error: 'Pick a physio.' }),
});

export type PlanSessionsPattern = z.output<typeof planSessionsPatternSchema>;

/** Booking the series: the pattern and the starts the desk kept (free ones and the picks). */
export const bookPlanSessionsSchema = planSessionsPatternSchema.extend({
  starts: z
    .array(z.coerce.date())
    .min(1, { error: 'Nothing to book: every date was skipped.' })
    .refine((starts) => new Set(starts.map((s) => s.getTime())).size === starts.length, {
      error: 'The same time was picked twice. Check dates again.',
    }),
});

export type BookPlanSessionsInput = z.output<typeof bookPlanSessionsSchema>;

/** Why a date of the series is not free, as its row says. */
export const seriesClashLabels = {
  past: 'That time has passed',
  off_grid: 'Not on the calendar grid',
  outside_hours: 'The physio is not working then',
  taken: 'The physio is booked then',
  no_machine: 'No machine is free then',
  not_offered: 'The physio does not take sessions here',
  needs_consultant: 'Needs a consultant physio',
  type_inactive: 'Sessions are no longer offered',
} as const satisfies Record<SlotRefusal, string>;

/** A session's start as the desk reads it, for example "Wed 29 Oct 2026, 10:00 AM". */
export function seriesStartText(instant: Date): string {
  const day = weekdayNames[isoWeekday(istDate(instant)) - 1]?.slice(0, 3) ?? '';
  return `${day} ${documentDate(instant)}, ${documentTime(instant)}`;
}

/** Refused when the ticked days differ from the plan's sessions a week. */
export function weekdaysMessage(ticked: number, sessionsPerWeek: number): string | undefined {
  if (ticked === sessionsPerWeek) return undefined;
  const days = sessionsPerWeek === 1 ? '1 day' : `${String(sessionsPerWeek)} days`;
  return `Tick ${days}: the plan is ${String(sessionsPerWeek)} a week.`;
}

/**
 * The physio's next session (SCH-12): the date offered first, today plus the days between the
 * plan's sessions (7 over its sessions a week, rounded, at least 1; a week without a frequency).
 */
export function nextSessionDate(today: string, sessionsPerWeek: number | null): string {
  return addDays(today, Math.max(1, Math.round(7 / (sessionsPerWeek ?? 1))));
}

/** The physio's free times on a date for the session's next one (SCH-12). */
export const nextSessionTimesSchema = z.object({
  appointmentId: z.guid(),
  date: calendarDateSchema,
});

/** Booking the session's next one at a picked time (SCH-12). */
export const bookNextSessionSchema = z.object({
  appointmentId: z.guid(),
  startsAt: z.coerce.date({ error: 'Pick a time.' }),
});
