'use client';

import { useActionState } from 'react';
import { FormMessage, secondaryButtonClass } from '../../../../../components/forms';
import {
  liftSelfBookingBlockAction,
  type BookingFormState,
} from '../../../../../modules/scheduling/actions';

const initialState: BookingFormState = {};

/** "Allow self booking again" (SCH-09): a Centre Manager or the Super Admin resets the counts. */
export function LiftBlockForm({ patientId }: { patientId: string }) {
  const [state, action, pending] = useActionState(liftSelfBookingBlockAction, initialState);
  return (
    <form action={action} className="flex flex-col gap-2">
      <input type="hidden" name="patientId" value={patientId} />
      {state.error ? <FormMessage tone="danger">{state.error}</FormMessage> : null}
      <button type="submit" disabled={pending} className={secondaryButtonClass}>
        Allow self booking again
      </button>
    </form>
  );
}
