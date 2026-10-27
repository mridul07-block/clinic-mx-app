import 'server-only';
import {
  episodeRecord,
  staffTreatsNow,
  visitsAhead,
  type DbOrTransaction,
  type EpisodeEntry,
  type StaffMember,
} from '@clinic-mx/db';
import {
  can,
  dischargeEpisodeSchema,
  dischargeReasonLabels,
  dischargeReasonRefusal,
  dischargeReasons,
  type DischargeReason,
} from '@clinic-mx/schemas';
import { staffService } from '../access/service';
import { changeEpisodeStatus, EpisodeError } from '../episodes/services';
import { ReviewError } from './errors';

/**
 * Discharge (OUT-10, PRD J6.6; user decisions 27 October 2026; docs/runbooks/sessions.md): on the
 * Review and discharge screen a consultant with the Treats patients tick closes any episode not
 * yet discharged, with a reason from the Blueprint's list (Other needs a note). A recovered reason
 * needs treatment first, so non attendance is never counted as recovered. The database checks the
 * ticks again, stamps who and when, and cancels the visits still booked ahead.
 */

export interface DischargeReasonOption {
  reason: DischargeReason;
  label: string;
  /** Why this reason cannot close the episode as it stands. */
  refusal?: string;
}

export interface DischargeView {
  reasons: DischargeReasonOption[];
  /** What discharging cancels, soonest first. */
  visitsAhead: { number: string; startsAt: Date }[];
  /** The reader discharges here: the Consultant tick (the Treats patients tick is read on post). */
  discharges: boolean;
}

/** The discharge form for an episode not yet discharged; undefined once it is. */
export async function dischargeView(
  tx: DbOrTransaction,
  actor: StaffMember,
  episode: EpisodeEntry,
): Promise<DischargeView | undefined> {
  if (episode.status === 'discharged') return undefined;
  const ahead = await visitsAhead(tx, episode.id);
  return {
    reasons: dischargeReasons.map((reason) => {
      const refusal = dischargeReasonRefusal(episode, reason);
      return {
        reason,
        label: dischargeReasonLabels[reason],
        ...(refusal ? { refusal } : {}),
      };
    }),
    visitsAhead: ahead.map(({ number, startsAt }) => ({ number, startsAt })),
    discharges: can(actor, 'consultant_records.sign'),
  };
}

/** Discharges the episode with its reason; the visits still booked ahead are cancelled. */
export const dischargeEpisode = staffService({
  action: 'consultant_records.sign',
  input: dischargeEpisodeSchema,
  run: async (tx, input, actor): Promise<{ status: 'discharged'; cancelled: number }> => {
    if (!(await staffTreatsNow(tx, actor.id))) {
      throw new ReviewError('Discharging needs the Treats patients tick.');
    }
    const episode = await episodeRecord(tx, input.episodeId);
    if (!episode) throw new ReviewError('That episode was not found.');
    const ahead = await visitsAhead(tx, input.episodeId);
    try {
      await changeEpisodeStatus(tx, input.episodeId, 'discharge', {
        reason: input.reason,
        ...(input.note ? { note: input.note } : {}),
      });
    } catch (error) {
      if (error instanceof EpisodeError) throw new ReviewError(error.message);
      throw error;
    }
    return { status: 'discharged', cancelled: ahead.length };
  },
});
