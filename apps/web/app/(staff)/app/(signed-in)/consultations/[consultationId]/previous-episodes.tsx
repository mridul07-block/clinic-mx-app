'use client';

import { formatIstDate, istDate } from '@clinic-mx/schemas';
import { useActionState } from 'react';
import { FormMessage } from '../../../../../../components/forms';
import {
  linkRecurrenceAction,
  type RecurrenceFormState,
} from '../../../../../../modules/episodes/actions';
import type { PreviousEpisodeItem } from '../../../../../../modules/episodes/recurrence';

/**
 * The patient's earlier, discharged episodes (SCH-14, PRD J7.5): the consultant marks the current
 * episode "Same problem again" against one of them, which links it as a recurrence, or removes the
 * link. Others read the list.
 */
export function PreviousEpisodes({
  consultationId,
  patientId,
  episodeId,
  linkedEpisodeId,
  previous,
  links,
}: {
  consultationId: string;
  patientId: string;
  episodeId: string;
  linkedEpisodeId: string | null;
  previous: PreviousEpisodeItem[];
  links: boolean;
}) {
  const [state, action, pending] = useActionState<RecurrenceFormState, FormData>(
    linkRecurrenceAction,
    {},
  );
  if (previous.length === 0) return null;
  return (
    <section
      className="flex flex-col gap-2 rounded-panel border border-line bg-surface p-4"
      aria-labelledby="previous-episodes"
      data-testid="previous-episodes"
    >
      <h2 id="previous-episodes" className="font-medium text-ink">
        Previous episodes
      </h2>
      <p className="text-sm text-ink-secondary">
        If this is the same problem again, mark the episode it recurs from.
      </p>
      <ul className="flex flex-col divide-y divide-line">
        {previous.map((episode) => {
          const linked = episode.id === linkedEpisodeId;
          return (
            <li
              key={episode.id}
              className="flex flex-col gap-1.5 py-2"
              data-testid="previous-episode"
              data-linked={linked ? 'yes' : 'no'}
            >
              <span className="font-medium text-ink">
                {episode.region ?? 'Region not recorded'}
                {episode.diagnosis ? `: ${episode.diagnosis}` : ''}
              </span>
              <span className="text-sm text-ink-secondary">
                {formatIstDate(istDate(new Date(episode.openedAt)))}
                {episode.closedAt
                  ? ` to ${formatIstDate(istDate(new Date(episode.closedAt)))}`
                  : ''}
                {episode.reason ? `, ${episode.reason}` : ''}
              </span>
              {linked ? (
                <span className="text-sm font-medium text-ink" data-testid="recurrence-of">
                  This episode is a recurrence of it.
                </span>
              ) : null}
              {links ? (
                <form action={action} className="self-start">
                  <input type="hidden" name="consultationId" value={consultationId} />
                  <input type="hidden" name="patientId" value={patientId} />
                  <input type="hidden" name="episodeId" value={episodeId} />
                  <input type="hidden" name="linkedEpisodeId" value={linked ? '' : episode.id} />
                  <button
                    type="submit"
                    disabled={pending}
                    className="min-h-11 rounded-control border border-line-control bg-surface px-3 text-sm font-medium text-ink"
                  >
                    {linked ? 'Not the same problem' : 'Same problem again'}
                  </button>
                </form>
              ) : null}
            </li>
          );
        })}
      </ul>
      {state.error ? <FormMessage tone="danger">{state.error}</FormMessage> : null}
    </section>
  );
}
