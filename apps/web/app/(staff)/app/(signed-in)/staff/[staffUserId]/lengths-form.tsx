'use client';

import { useActionState } from 'react';
import { FormMessage, TextField, primaryButtonClass } from '../../../../../../components/forms';
import {
  setPhysioLengthsAction,
  type AppointmentTypeFormState,
} from '../../../../../../modules/appointment-types/actions';

const initialState: AppointmentTypeFormState = {};

/**
 * A physio's own appointment lengths (SET-03): minutes per type, or blank to use the type's
 * length, shown as the placeholder.
 */
export function LengthsForm({
  staffUserId,
  types,
  slotMinutes,
}: {
  staffUserId: string;
  /** Active types, with the clinic length and this physio's own, if set. */
  types: { id: string; name: string; minutes: number; own?: number }[];
  slotMinutes: number;
}) {
  const [state, action, pending] = useActionState(setPhysioLengthsAction, initialState);
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      {state.error ? <FormMessage tone="danger">{state.error}</FormMessage> : null}
      {state.notice ? <FormMessage tone="info">{state.notice}</FormMessage> : null}
      <input type="hidden" name="staffUserId" value={staffUserId} />
      <p className="text-ink-secondary">
        Minutes, in steps of {slotMinutes}. Leave a length blank to use the clinic length shown.
      </p>
      {types.map((type) => (
        <TextField
          key={type.id}
          label={type.name}
          name={`length:${type.id}`}
          inputMode="numeric"
          autoComplete="off"
          placeholder={String(type.minutes)}
          defaultValue={state.values?.[type.id] ?? (type.own === undefined ? '' : String(type.own))}
          helper={`Clinic length: ${String(type.minutes)} minutes.`}
          error={state.fieldErrors?.[type.id]}
        />
      ))}
      <button type="submit" disabled={pending} className={primaryButtonClass}>
        {pending ? 'Saving' : 'Save lengths'}
      </button>
    </form>
  );
}
