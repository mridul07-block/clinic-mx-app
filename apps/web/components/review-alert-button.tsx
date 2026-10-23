'use client';

import { useActionState } from 'react';
import { reviewAlertAction, type AlertFormState } from '../modules/alerts/actions';

const initialState: AlertFormState = {};

/** "I'm reviewing" (ALT-01): the clinician takes the alert; its emergency banner ends. */
export function ReviewAlertButton({ alertId, className }: { alertId: string; className: string }) {
  const [state, action, pending] = useActionState(reviewAlertAction, initialState);
  return (
    <form action={action} className="flex flex-col items-start gap-1">
      <input type="hidden" name="alertId" value={alertId} />
      <button type="submit" disabled={pending} className={className}>
        I’m reviewing
      </button>
      {state.error ? (
        <p role="status" className="text-sm">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
