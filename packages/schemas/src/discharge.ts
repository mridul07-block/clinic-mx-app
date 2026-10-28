import { z } from 'zod';
import {
  dischargeReasons,
  episodeTransition,
  goalOutcomes,
  type DischargeReason,
  type EpisodeState,
  type EpisodeStatus,
} from './episodes';
import { formatIstDate, istDate } from './ist';

/**
 * Discharge (OUT-10, PRD J6.6, J5.12 and decision 19; user decisions 27 October 2026). A consultant
 * with the Treats patients tick discharges an episode on the Review and discharge screen with a
 * reason from the Blueprint's list (Other needs a note); a recovered reason only after treatment,
 * so non attendance is never counted as recovered. Discharging cancels the episode's future booked
 * visits. Every day a job marks an episode nobody has attended for the lost to follow up period,
 * with nothing booked ahead, Lost to follow up (never discharged, never closed) and gives the
 * consultant a task; booking again brings it back.
 */

export const DISCHARGE_NOTE_MAX = 1000;
/** Ongoing needs and Recommendations, each (OUT-11). */
export const DISCHARGE_TEXT_MAX = 2000;

const reportText = (label: string) =>
  z
    .string()
    .trim()
    .max(DISCHARGE_TEXT_MAX, {
      error: `Keep ${label} under ${String(DISCHARGE_TEXT_MAX)} characters.`,
    })
    .optional();

export const dischargeEpisodeSchema = z
  .object({
    episodeId: z.guid(),
    reason: z.enum(dischargeReasons, { error: 'Choose the discharge reason.' }),
    note: z
      .string()
      .trim()
      .max(DISCHARGE_NOTE_MAX, {
        error: `Keep the note under ${String(DISCHARGE_NOTE_MAX)} characters.`,
      })
      .optional(),
    /** OUT-11: one outcome per goal of the plan, in its order. */
    goals: z
      .array(
        z.enum(goalOutcomes, {
          error: 'Mark each goal Achieved, Partly achieved or Not achieved.',
        }),
      )
      .max(20)
      .default([]),
    ongoingNeeds: reportText('the ongoing needs'),
    recommendations: reportText('the recommendations'),
  })
  .refine((input) => input.reason !== 'other' || Boolean(input.note), {
    error: 'Say why the episode is discharged.',
    path: ['note'],
  });

export type DischargeEpisodeInput = z.infer<typeof dischargeEpisodeSchema>;

/** Why `reason` cannot close the episode as it stands (the machine's words), or undefined. */
export function dischargeReasonRefusal(
  state: EpisodeState,
  reason: DischargeReason,
): string | undefined {
  // The note is checked on its own; this asks only whether the reason fits the episode.
  const result = episodeTransition(state, 'discharge', { reason, note: 'checked separately' });
  return result.ok ? undefined : result.refusal;
}

/** The statuses the lost to follow up check watches; On hold is a deliberate pause. */
export const watchedForLoss: readonly EpisodeStatus[] = [
  'intake_pending',
  'awaiting_consultation',
  'plan_proposed',
  'active',
  'under_review',
];

/**
 * The lost to follow up check runs every morning at 6:00 AM IST, before the centres open (TAD job
 * table: daily). The period it looks back over is the `clinical.lost_to_follow_up_days` setting.
 */
export const LOST_TO_FOLLOW_UP_CHECK_TIME = '06:00';

/** The task kind of the lost to follow up check, for the consultant. */
export const LOST_TO_FOLLOW_UP_TASK = 'review.lost_to_follow_up';

/**
 * Progress alerts (ALT-02, in part; recommended defaults chosen under the user's standing approval,
 * 28 October 2026; docs/runbooks/tasks.md). A session note signed "Worse", or with "Escalate"
 * next, is a high task for the consultant (the database, at signing). A 6 week review whose date
 * has passed, not attended, nothing booked ahead and no final test, is a task for them from the
 * daily check at 6:00 AM IST, closed by itself once the review is booked or done. Plateau, no
 * change, adherence, milestones and repeated missed sessions wait for the client (DECISION ALT-02).
 */
export const WORSENING_TASK = 'review.worsening';
export const REVIEW_OVERDUE_TASK = 'review.overdue';
export const REVIEW_OVERDUE_CHECK_TIME = '06:00';

/** The overdue task's title, for example "6 week review overdue since 9 Dec 2026". */
export function reviewOverdueTitle(reviewDate: string): string {
  return `6 week review overdue since ${formatIstDate(reviewDate)}`;
}

/** The task's title, for example "Lost to follow up: no visit since 27 Sep 2026". */
export function lostToFollowUpTitle(since: Date): string {
  return `Lost to follow up: no visit since ${formatIstDate(istDate(since))}`;
}
