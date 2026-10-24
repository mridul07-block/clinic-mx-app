'use client';

import { useActionState } from 'react';
import { primaryButtonClass } from '../../../../../components/forms';
import { startVisitAction, type StartVisitState } from '../../../../../modules/my-patients/actions';

const initialState: StartVisitState = {};

/** Start consultation or Start session (CLN-01): the visit becomes In progress. */
export function StartButton({
  appointmentId,
  label,
  patientName,
}: {
  appointmentId: string;
  label: string;
  patientName: string;
}) {
  const [state, action, pending] = useActionState(startVisitAction, initialState);
  return (
    <form action={action} className="flex flex-col gap-1.5 md:items-end">
      <input type="hidden" name="appointmentId" value={appointmentId} />
      <button
        type="submit"
        disabled={pending}
        aria-label={`${label} for ${patientName}`}
        className={`${primaryButtonClass} md:w-auto`}
      >
        {label}
      </button>
      {state.error ? (
        <p role="alert" className="text-sm text-danger">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
