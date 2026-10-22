'use client';

import { useActionState, useState } from 'react';
import {
  FormMessage,
  TextField,
  dangerButtonClass,
  primaryButtonClass,
  secondaryButtonClass,
} from '../../../../../components/forms';
import {
  addAppointmentTypeAction,
  editAppointmentTypeAction,
  setAppointmentTypeActiveAction,
  type AppointmentTypeFormState,
} from '../../../../../modules/appointment-types/actions';

const initialState: AppointmentTypeFormState = {};

/** An appointment type's name and length (SET-03). */
export function AppointmentTypeForm({
  type,
  slotMinutes,
}: {
  type?: { appointmentTypeId: string; name: string; minutes: string };
  slotMinutes: number;
}) {
  const [state, action, pending] = useActionState(
    type ? editAppointmentTypeAction : addAppointmentTypeAction,
    initialState,
  );
  const value = (field: 'name' | 'minutes') => state.values?.[field] ?? type?.[field] ?? '';
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      {state.error ? <FormMessage tone="danger">{state.error}</FormMessage> : null}
      {type ? (
        <input type="hidden" name="appointmentTypeId" value={type.appointmentTypeId} />
      ) : null}
      <TextField
        label="Name"
        name="name"
        autoComplete="off"
        maxLength={60}
        defaultValue={value('name')}
        helper={type ? undefined : 'As staff and patients see it when booking.'}
        error={state.fieldErrors?.name}
      />
      <TextField
        label="Length in minutes"
        name="minutes"
        inputMode="numeric"
        autoComplete="off"
        defaultValue={value('minutes')}
        helper={`In steps of ${String(slotMinutes)} minutes. Physios may have their own length, set on their staff page.`}
        error={state.fieldErrors?.minutes}
      />
      <button type="submit" disabled={pending} className={primaryButtonClass}>
        {pending ? 'Saving' : type ? 'Save appointment type' : 'Add appointment type'}
      </button>
    </form>
  );
}

/**
 * Deactivates a type after a confirm step (no longer offered for new bookings; history stays), or
 * reactivates it.
 */
export function AppointmentTypeActiveForm({
  appointmentTypeId,
  name,
  active,
}: {
  appointmentTypeId: string;
  name: string;
  active: boolean;
}) {
  const [state, action, pending] = useActionState(setAppointmentTypeActiveAction, initialState);
  const [confirming, setConfirming] = useState(false);
  if (active && !confirming) {
    return (
      <button
        type="button"
        className={secondaryButtonClass}
        onClick={() => {
          setConfirming(true);
        }}
      >
        Deactivate appointment type
      </button>
    );
  }
  return (
    <form action={action} className="flex flex-col gap-3">
      {state.error ? <FormMessage tone="danger">{state.error}</FormMessage> : null}
      <input type="hidden" name="appointmentTypeId" value={appointmentTypeId} />
      <input type="hidden" name="active" value={active ? 'false' : 'true'} />
      {active ? (
        <>
          <p className="text-ink-secondary">
            Deactivate {name}? It is no longer offered for new bookings. Appointments already booked
            and its history stay.
          </p>
          <button type="submit" disabled={pending} className={dangerButtonClass}>
            {pending ? 'Deactivating' : 'Deactivate appointment type'}
          </button>
          <button
            type="button"
            className={secondaryButtonClass}
            onClick={() => {
              setConfirming(false);
            }}
          >
            Keep it active
          </button>
        </>
      ) : (
        <button type="submit" disabled={pending} className={secondaryButtonClass}>
          {pending ? 'Reactivating' : 'Reactivate appointment type'}
        </button>
      )}
    </form>
  );
}
