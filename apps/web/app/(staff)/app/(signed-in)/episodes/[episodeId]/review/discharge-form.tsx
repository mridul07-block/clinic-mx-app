'use client';

import {
  DISCHARGE_NOTE_MAX,
  DISCHARGE_TEXT_MAX,
  formatIstDateTime,
  goalOutcomeLabels,
  goalOutcomes,
} from '@clinic-mx/schemas';
import { useActionState, useState } from 'react';
import { primaryButtonClass } from '../../../../../../../components/forms';
import {
  dischargeEpisodeAction,
  type ReadinessFormState,
} from '../../../../../../../modules/reviews/actions';
import type { DischargeView } from '../../../../../../../modules/reviews/discharge';

const initialState: ReadinessFormState = {};
const textarea =
  'w-full min-w-0 rounded-control border border-line-control bg-surface px-3 py-2 text-md shadow-xs hover:border-ink-muted';
// A tappable choice; the checked one fills (design system v2: words, not colour alone).
const chip =
  'flex min-h-row flex-1 cursor-pointer items-center justify-center text-center rounded-control border border-line-control bg-surface px-3 text-sm font-medium has-checked:border-ink has-checked:bg-ink has-checked:text-surface has-focus-visible:outline-2 pointer-coarse:min-h-row-touch';
const radioRow =
  'flex min-h-row cursor-pointer items-start gap-3 rounded-control border border-line-control px-3 py-2.5 has-checked:border-ink has-disabled:cursor-default has-disabled:bg-surface-sunken pointer-coarse:min-h-row-touch';

/**
 * The discharge (OUT-10, Frontend Specification "Review and discharge": discharge reason, then
 * "Discharge"): one reason from the list, a reason that cannot close this episode greyed with why;
 * a note, required for Other; the visits still booked ahead that discharging cancels. OUT-11
 * adds what the discharge report prints: each goal of the plan marked, ongoing needs and
 * recommendations. Built for 360 px: every row stacks.
 */
export function DischargeForm({ episodeId, view }: { episodeId: string; view: DischargeView }) {
  const [state, action, pending] = useActionState(dischargeEpisodeAction, initialState);
  const [reason, setReason] = useState('');
  const ahead = view.visitsAhead;
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="episodeId" value={episodeId} />
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-sm font-medium text-ink-secondary">Discharge reason</legend>
        {view.reasons.map((option) => (
          <label key={option.reason} className={radioRow} data-testid="discharge-reason">
            <input
              type="radio"
              name="reason"
              value={option.reason}
              disabled={Boolean(option.refusal)}
              required
              onChange={() => {
                setReason(option.reason);
              }}
              className="mt-1 size-4 shrink-0 accent-ink"
            />
            <span className="flex flex-col gap-0.5">
              <span className="font-medium text-ink">{option.label}</span>
              {option.refusal ? (
                <span className="text-sm text-ink-muted">{option.refusal}</span>
              ) : null}
            </span>
          </label>
        ))}
      </fieldset>
      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium text-ink-secondary">
          {reason === 'other' ? 'Why the episode is discharged' : 'Note (optional)'}
        </span>
        <textarea
          name="note"
          rows={2}
          required={reason === 'other'}
          maxLength={DISCHARGE_NOTE_MAX}
          className={textarea}
        />
      </label>
      {view.goals.length > 0 ? (
        <fieldset className="flex flex-col gap-3" data-testid="discharge-goals">
          <legend className="mb-2 text-sm font-medium text-ink-secondary">Goals</legend>
          <input type="hidden" name="goalCount" value={view.goals.length} />
          {view.goals.map((goal, index) => (
            <div
              key={[String(index), goal].join('-')}
              className="flex flex-col gap-1.5"
              data-testid="discharge-goal"
            >
              <span className="text-ink">{goal}</span>
              <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={goal}>
                {goalOutcomes.map((outcome) => (
                  <label key={outcome} className={chip}>
                    <input
                      type="radio"
                      name={['goal', String(index)].join('-')}
                      value={outcome}
                      required
                      className="sr-only"
                    />
                    {goalOutcomeLabels[outcome]}
                  </label>
                ))}
              </div>
            </div>
          ))}
        </fieldset>
      ) : null}
      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium text-ink-secondary">Ongoing needs (optional)</span>
        <textarea
          name="ongoingNeeds"
          rows={2}
          maxLength={DISCHARGE_TEXT_MAX}
          className={textarea}
        />
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium text-ink-secondary">Recommendations (optional)</span>
        <textarea
          name="recommendations"
          rows={2}
          maxLength={DISCHARGE_TEXT_MAX}
          className={textarea}
        />
      </label>
      {ahead.length > 0 ? (
        <div
          className="flex flex-col gap-1 rounded-control border border-waiting-line bg-waiting-soft px-3 py-2.5"
          data-testid="discharge-cancels"
        >
          <p className="text-sm font-medium text-waiting-strong">
            {ahead.length === 1
              ? 'Discharging cancels 1 booked visit:'
              : `Discharging cancels ${String(ahead.length)} booked visits:`}
          </p>
          <ul className="flex flex-col gap-0.5 text-sm text-ink">
            {ahead.map((visit) => (
              <li key={visit.number}>
                {visit.number} · {formatIstDateTime(visit.startsAt)}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <button
        type="submit"
        disabled={pending}
        className={`${primaryButtonClass} md:w-auto md:self-start`}
      >
        {pending ? 'Discharging…' : 'Discharge'}
      </button>
      {state.error ? (
        <p role="alert" className="text-sm text-danger">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
