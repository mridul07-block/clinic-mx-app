import { z } from 'zod';
import {
  dischargeReasons,
  episodeTransition,
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

/** The task's title, for example "Lost to follow up: no visit since 27 Sep 2026". */
export function lostToFollowUpTitle(since: Date): string {
  return `Lost to follow up: no visit since ${formatIstDate(istDate(since))}`;
}
