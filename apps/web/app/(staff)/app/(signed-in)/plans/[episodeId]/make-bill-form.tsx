'use client';

import { useActionState } from 'react';
import { FormMessage, secondaryButtonClass } from '../../../../../../components/forms';
import {
  makeConsultationBillAction,
  type BillFormState,
} from '../../../../../../modules/billing/actions';

const initialState: BillFormState = {};

/** "Make the consultation bill" once the consultant's fee is set (BIL-05). */
export function MakeBillForm({ episodeId }: { episodeId: string }) {
  const [state, action, pending] = useActionState(makeConsultationBillAction, initialState);
  return (
    <form action={action} className="flex flex-col gap-2">
      <input type="hidden" name="episodeId" value={episodeId} />
      {state.error ? <FormMessage tone="danger">{state.error}</FormMessage> : null}
      <button
        type="submit"
        disabled={pending}
        className={`${secondaryButtonClass} sm:w-auto sm:self-start`}
      >
        Make the consultation bill
      </button>
    </form>
  );
}
