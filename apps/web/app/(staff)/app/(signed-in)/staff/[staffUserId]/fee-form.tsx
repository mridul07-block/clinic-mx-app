'use client';

import { formatRupees } from '@clinic-mx/schemas';
import { useActionState } from 'react';
import { FormMessage, primaryButtonClass } from '../../../../../../components/forms';
import {
  setConsultationFeeAction,
  type ConsultationFeeFormState,
} from '../../../../../../modules/consultation-fees/actions';

const initialState: ConsultationFeeFormState = {};

const choiceClass =
  'flex min-h-row items-center gap-3 rounded-control px-1 text-ink pointer-coarse:min-h-row-touch';

/**
 * A consultant's consultation fee (decision G4, SCH-05): one of the clinic's consultation prices,
 * shown in their calendar column, or none yet.
 */
export function FeeForm({
  staffUserId,
  options,
  current,
}: {
  staffUserId: string;
  options: { id: string; label: string; amountPaise: number }[];
  current: string | null;
}) {
  const [state, action, pending] = useActionState(setConsultationFeeAction, initialState);
  return (
    <form action={action} className="flex flex-col gap-3" noValidate>
      {state.error ? <FormMessage tone="danger">{state.error}</FormMessage> : null}
      {state.notice ? <FormMessage tone="info">{state.notice}</FormMessage> : null}
      <input type="hidden" name="staffUserId" value={staffUserId} />
      <fieldset className="flex flex-col gap-1">
        <legend className="mb-1 text-ink-secondary">
          Set by their level; shown in their calendar column.
        </legend>
        {options.map((option) => (
          <label key={option.id} className={choiceClass}>
            <input
              type="radio"
              name="priceItemId"
              value={option.id}
              defaultChecked={current === option.id}
              className="size-4 accent-accent"
            />
            <span>
              {option.label}{' '}
              <span className="tabular-nums">{formatRupees(option.amountPaise)}</span>
            </span>
          </label>
        ))}
        <label className={choiceClass}>
          <input
            type="radio"
            name="priceItemId"
            value=""
            defaultChecked={current === null}
            className="size-4 accent-accent"
          />
          <span>Not set</span>
        </label>
      </fieldset>
      <button type="submit" disabled={pending} className={primaryButtonClass}>
        {pending ? 'Saving' : 'Save fee'}
      </button>
    </form>
  );
}
