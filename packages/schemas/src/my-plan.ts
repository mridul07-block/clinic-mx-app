import { z } from 'zod';
import { formatIstDate, istDate } from './ist';
import { packageState } from './packages';

/**
 * My plan (PAT-01, in part; PRD M13 and J5.7; Frontend Specification "My plan"). Recommended
 * defaults chosen under the user's standing approval, 28 October 2026 (docs/runbooks/my-plan.md):
 * the patient's own page for their episode, read through `internal.my_plan()`: the week of the
 * plan, the next visit with its map, the home exercises as the plan lists them, the package's
 * sessions (never a price) and their pain readings as numbers. Exercise videos wait for SET-07,
 * Reschedule for the WhatsApp Flow (WA-05), and the diagnosis in plain words for clinician-approved
 * patient content (AI-07); no clinical wording is made up here.
 */

const painValue = z.number().int().min(0).max(10).nullable();

export const myPlanSchema = z.object({
  name: z.string(),
  episodeStatus: z.string(),
  centrePhone: z.string().nullable(),
  plan: z
    .object({
      homeProgramme: z.array(
        z.object({ exercise: z.string(), dose: z.string(), note: z.string() }),
      ),
      weeks: z.number().int().nullable(),
      sessionsPerWeek: z.number().int().nullable(),
      since: z.string(),
    })
    .nullable(),
  next: z
    .object({
      startsAt: z.string(),
      type: z.string(),
      centre: z.string(),
      mapLink: z.string().nullable(),
      phone: z.string().nullable(),
      physio: z.string(),
    })
    .nullable(),
  package: z
    .object({
      name: z.string(),
      total: z.number().int(),
      used: z.number().int(),
      validUntil: z.string(),
      reschedulesLeft: z.number().int(),
    })
    .nullable(),
  pain: z.array(
    z.object({
      number: z.number().int(),
      signedAt: z.string(),
      rest: painValue,
      activity: painValue,
      after: painValue,
    }),
  ),
  /** Today in IST, the rows of the newest plan ticked today, and the days done lately (PAT-02). */
  today: z.iso.date(),
  tickedToday: z.array(z.number().int().min(0)),
  tickedDays: z.array(z.iso.date()),
  /** The first day the patient could tick (a plan and a My plan link); earlier days not tracked. */
  trackedFrom: z.iso.date().nullable(),
});

/** A tick or an untick of a home programme row, as the My plan page posts it (PAT-02). */
export const exerciseTickInputSchema = z.object({
  index: z.coerce.number().int().min(0).max(29),
  exercise: z.string().min(1).max(200),
  done: z.enum(['yes', 'no']).transform((value) => value === 'yes'),
});

export type MyPlan = z.infer<typeof myPlanSchema>;

/**
 * The week of the plan: from the day the plan was made (IST), "Week 2 of 6", or "Week 2" when the
 * plan gives no length; past its length it stays at the last week.
 */
export function planWeek(since: Date, weeks: number | null, now: Date): string {
  const days = Math.floor(
    (Date.parse(istDate(now)) - Date.parse(istDate(since))) / (24 * 60 * 60 * 1000),
  );
  const week = Math.max(1, Math.floor(days / 7) + 1);
  return weeks === null
    ? `Week ${String(week)}`
    : `Week ${String(Math.min(week, weeks))} of ${String(weeks)}`;
}

/**
 * The package's line under its meter on an IST day (`today`), in its state as staff see it
 * (`packageState`): "Valid until 31 Jan 2027 · 2 reschedules left" while active, "All sessions
 * used", or "Expired on 31 Aug 2026" with the sessions it left unused.
 */
export function packageLine(
  held: { total: number; used: number; validUntil: string; reschedulesLeft: number },
  today: string,
): string {
  const state = packageState(
    {
      sessionsTotal: held.total,
      sessionsUsed: held.used,
      validUntil: held.validUntil,
      cancelledAt: null,
    },
    today,
  );
  if (state === 'used_up') return 'All sessions used';
  if (state === 'expired') {
    const left = held.total - held.used;
    return `Expired on ${formatIstDate(held.validUntil)} with ${String(left)} ${left === 1 ? 'session' : 'sessions'} unused`;
  }
  const reschedules =
    held.reschedulesLeft === 1
      ? '1 reschedule left'
      : `${String(held.reschedulesLeft)} reschedules left`;
  return `Valid until ${formatIstDate(held.validUntil)} · ${reschedules}`;
}
