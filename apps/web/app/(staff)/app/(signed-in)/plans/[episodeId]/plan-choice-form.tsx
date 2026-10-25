'use client';

import { useActionState } from 'react';
import { FormMessage, primaryButtonClass } from '../../../../../../components/forms';
import {
  recordPlanChoiceAction,
  type PlanChoiceFormState,
} from '../../../../../../modules/billing/actions';

const initialState: PlanChoiceFormState = {};

export interface ChoiceOption {
  value: string;
  label: string;
  /** The price beside it, already formatted, when there is one. */
  amount?: string;
  helper?: string;
}

/**
 * The patient's choice (BIL-02, PRD J4.3): one of the packages offered, pay per session, "I'll
 * think about it" or "No thanks", for the session type on the sheet. A refused post keeps the
 * option picked.
 */
export function PlanChoiceForm({
  episodeId,
  session,
  options,
}: {
  episodeId: string;
  session: string;
  options: ChoiceOption[];
}) {
  const [state, action, pending] = useActionState(recordPlanChoiceAction, initialState);
  return (
    <form action={action} className="flex flex-col gap-2" data-testid="plan-choice-form">
      <input type="hidden" name="episodeId" value={episodeId} />
      <input type="hidden" name="session" value={session} />
      {state.error ? <FormMessage tone="danger">{state.error}</FormMessage> : null}
      <fieldset className="flex flex-col gap-1">
        <legend className="mb-1 text-sm text-ink-secondary">What did the patient decide?</legend>
        {options.map((option) => (
          <label key={option.value} className="flex min-h-11 items-start gap-3 py-1">
            <input
              type="radio"
              name="option"
              value={option.value}
              defaultChecked={state.option === option.value}
              className="mt-1 size-4 shrink-0 accent-accent"
            />
            <span className="flex flex-1 flex-col">
              <span>{option.label}</span>
              {option.helper ? (
                <span className="text-sm text-ink-muted">{option.helper}</span>
              ) : null}
            </span>
            {option.amount ? (
              <span className="whitespace-nowrap text-right tabular-nums">{option.amount}</span>
            ) : null}
          </label>
        ))}
      </fieldset>
      <button
        type="submit"
        disabled={pending}
        className={`${primaryButtonClass} sm:w-auto sm:self-start`}
      >
        Record choice
      </button>
    </form>
  );
}
