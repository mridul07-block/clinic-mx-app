import { z } from 'zod';
import { addDays, formatIstDate, isoWeekday, istDate } from './ist';

/**
 * Home exercise adherence (PAT-02; PRD J5.7: "Patients tick home exercises on My plan; adherence
 * fills the next note"). Recommended defaults chosen under the user's standing approval,
 * 28 October 2026 (DECISION PAT-02, docs/runbooks/my-plan.md). No document defines adherence, so
 * it is a plain count of days, never a judgement: a day is done when the patient ticked any
 * exercise of their plan on My plan that IST day. The next session note shows the days done since
 * the session before (or since the plan); the week strip shows the days of the plan's week.
 */

/** The adherence a session note shows, as `internal.session_adherence` works it out. */
export const adherenceSnapshotSchema = z.object({
  from: z.iso.date(),
  to: z.iso.date(),
  since: z.enum(['last_session', 'plan']),
  days: z.number().int().min(0),
  daysDone: z.number().int().min(0),
  /** Whether the episode had a My plan link by then; without one there was nothing to tick. */
  tracked: z.boolean(),
});

export type AdherenceSnapshot = z.infer<typeof adherenceSnapshotSchema>;

/** The session note's adherence line, in plain words. */
export function adherenceLine(snapshot: AdherenceSnapshot): string {
  const since = snapshot.since === 'plan' ? 'since the plan was made' : 'since the last session';
  if (snapshot.days === 0) return `Home exercises: no days ${since}.`;
  if (!snapshot.tracked) {
    return 'Home exercises: not tracked, as the patient had no My plan link yet.';
  }
  return `Home exercises ticked on My plan: ${String(snapshot.daysDone)} of ${String(snapshot.days)} days ${since} (${formatIstDate(snapshot.from)} to ${formatIstDate(snapshot.to)}).`;
}

const weekdays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;

export interface WeekStripDay {
  day: string;
  date: string;
  state: 'done' | 'missed' | 'to_come' | 'not_tracked';
}

/**
 * Seven IST days from `first` for the week strip: done when ticked, missed when past and not,
 * and still to come from today on unless today is ticked. Days before `trackedFrom` (the first day
 * the patient could tick: a plan and a My plan link), or every day without one, are not tracked.
 */
export function weekStripDays(
  first: string,
  tickedDays: readonly string[],
  today: string,
  trackedFrom: string | null,
) {
  const ticked = new Set(tickedDays);
  return Array.from({ length: 7 }, (_, offset): WeekStripDay => {
    const date = addDays(first, offset);
    const state = ticked.has(date)
      ? 'done'
      : trackedFrom === null || date < trackedFrom
        ? 'not_tracked'
        : date < today
          ? 'missed'
          : 'to_come';
    return {
      day: weekdays[isoWeekday(date) - 1] ?? '',
      date: formatIstDate(date).replace(/ \d{4}$/, ''),
      state,
    };
  });
}

/** The first day of the plan week that holds `today`, counting weeks from the plan's day (IST). */
export function planWeekStart(since: Date, today: string): string {
  const start = istDate(since);
  const days = Math.max(0, Math.round((Date.parse(today) - Date.parse(start)) / 86_400_000));
  return addDays(start, Math.floor(days / 7) * 7);
}
