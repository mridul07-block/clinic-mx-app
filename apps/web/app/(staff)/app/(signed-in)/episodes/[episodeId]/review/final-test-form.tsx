'use client';

import { reassessmentBlockers, type ReassessmentEntry } from '@clinic-mx/schemas';
import { useActionState, useState } from 'react';
import { primaryButtonClass } from '../../../../../../../components/forms';
import { RetestInputs } from '../../../../../../../components/retest-inputs';
import {
  signFinalTestAction,
  type FinalTestState,
} from '../../../../../../../modules/reviews/actions';
import type { ReviewItem } from '../../../../../../../modules/reviews/services';

const initialState: FinalTestState = {};

const notTested = (reason: string | null) => `Not tested${reason ? ` (${reason})` : ''}`;

/**
 * Final testing (OUT-07): each baseline measure retested, with its baseline and session 4
 * readings above it and the change as it is typed, or Not tested with a reason; signed once as
 * written. What still holds signing back is listed above the button.
 */
export function FinalTestForm({
  episodeId,
  items,
  sessionNumber,
}: {
  episodeId: string;
  items: ReviewItem[];
  sessionNumber: number | null;
}) {
  const [state, action, pending] = useActionState(signFinalTestAction, initialState);
  const [entries, setEntries] = useState<Record<string, ReassessmentEntry>>({});
  const blockers = reassessmentBlockers(
    entries,
    items.map((item) => item.measure),
  );
  return (
    <form action={action} className="flex flex-col gap-3" data-testid="final-test-form">
      <input type="hidden" name="episodeId" value={episodeId} />
      <input type="hidden" name="entries" value={JSON.stringify(entries)} />
      <p className="text-sm text-ink-secondary">
        Take each baseline measure again, or mark it Not tested with a reason. Once signed, it never
        changes.
      </p>
      <ul className="flex flex-col gap-3">
        {items.map((item) => {
          const { measure } = item;
          return (
            <li
              key={measure.key}
              data-testid="final-test-item"
              className="flex flex-col gap-2 border-t border-line pt-3 first:border-0 first:pt-0"
            >
              <span className="font-medium text-ink">{measure.name}</span>
              <p className="text-sm text-ink-secondary">
                Baseline: {item.baseline ?? notTested(item.baselineNotTested)}
              </p>
              {sessionNumber !== null ? (
                <p className="text-sm text-ink-secondary">
                  Session {sessionNumber}: {item.session ?? notTested(item.sessionNotTested)}
                </p>
              ) : null}
              <RetestInputs
                measure={measure}
                baselineEntry={item.baselineEntry}
                entry={entries[measure.key]}
                readOnly={pending}
                testIdPrefix="final-test"
                onChange={(entry) => {
                  setEntries((current) => ({ ...current, [measure.key]: entry }));
                }}
              />
            </li>
          );
        })}
      </ul>
      {blockers.length > 0 ? (
        <ul
          className="flex flex-col gap-1 text-sm text-ink-secondary"
          data-testid="final-test-blockers"
        >
          {blockers.map((blocker) => (
            <li key={blocker}>{blocker}</li>
          ))}
        </ul>
      ) : null}
      <button
        type="submit"
        disabled={pending || blockers.length > 0}
        className={`${primaryButtonClass} md:w-auto md:self-start`}
      >
        {pending ? 'Signing…' : 'Sign final testing'}
      </button>
      {state.error ? (
        <p role="alert" className="text-sm text-danger">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
