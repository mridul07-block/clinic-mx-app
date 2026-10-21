'use client';

import { KIOSK_DEFAULT_NAME } from '@clinic-mx/schemas';
import { useActionState, useId, useState } from 'react';
import {
  FormMessage,
  TextField,
  dangerButtonClass,
  primaryButtonClass,
  secondaryButtonClass,
} from '../../../../../components/forms';
import {
  setUpKioskAction,
  stopKioskAction,
  type KioskFormState,
} from '../../../../../modules/kiosk/actions';

const initialState: KioskFormState = {};

const choiceClass =
  'flex min-h-row items-center gap-3 rounded-control px-1 text-ink pointer-coarse:min-h-row-touch';

/**
 * Sets the device this page is open on up as a centre's kiosk (IAM-10). The centre is asked only
 * of someone who works in more than one. It signs the staff member out, so it says so first.
 */
export function SetUpKioskForm({ centres }: { centres: { id: string; name: string }[] }) {
  const [state, action, pending] = useActionState(setUpKioskAction, initialState);
  const id = useId();
  const only = centres.length === 1 ? centres[0] : undefined;
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      {state.error ? <FormMessage tone="danger">{state.error}</FormMessage> : null}
      <p className="text-ink-secondary">
        Do this on the tablet itself. It signs you out, and from then on this browser shows only
        patient forms. To use it as a normal browser again, stop it here from another device.
      </p>
      {only ? (
        <>
          <input type="hidden" name="centreId" value={only.id} />
          <p className="text-ink">
            Centre: <span className="font-medium">{only.name}</span>
          </p>
        </>
      ) : (
        <fieldset
          className="flex flex-col gap-1"
          aria-describedby={state.fieldErrors?.centreId ? `${id}-centre-error` : undefined}
        >
          <legend className="mb-1 font-medium text-ink">Centre</legend>
          {centres.map((centre) => (
            <label key={centre.id} className={choiceClass}>
              <input
                type="radio"
                name="centreId"
                value={centre.id}
                defaultChecked={state.values?.centreId === centre.id}
                className="size-4 accent-accent"
              />
              {centre.name}
            </label>
          ))}
          {state.fieldErrors?.centreId ? (
            <p id={`${id}-centre-error`} className="text-sm text-danger">
              {state.fieldErrors.centreId}
            </p>
          ) : null}
        </fieldset>
      )}
      <TextField
        label="Tablet name"
        name="name"
        autoComplete="off"
        maxLength={60}
        defaultValue={state.values?.name ?? KIOSK_DEFAULT_NAME}
        helper="Shown in this list, so you can tell tablets apart."
        error={state.fieldErrors?.name}
      />
      <button type="submit" disabled={pending} className={primaryButtonClass}>
        {pending ? 'Setting up' : 'Set up as kiosk and sign out'}
      </button>
    </form>
  );
}

/** Stops a tablet being a kiosk, after a confirm step: it has to be set up again on the tablet. */
export function StopKioskForm({ kioskId, name }: { kioskId: string; name: string }) {
  const [state, action, pending] = useActionState(stopKioskAction, initialState);
  const [confirming, setConfirming] = useState(false);
  if (!confirming) {
    return (
      <button
        type="button"
        className={secondaryButtonClass}
        onClick={() => {
          setConfirming(true);
        }}
      >
        Stop kiosk
      </button>
    );
  }
  return (
    <form action={action} className="flex flex-col gap-3">
      {state.error ? <FormMessage tone="danger">{state.error}</FormMessage> : null}
      <p className="text-ink-secondary">
        Stop “{name}” being a kiosk? It closes any form on it, and must be set up again on the
        tablet to be a kiosk.
      </p>
      <input type="hidden" name="kioskId" value={kioskId} />
      <button type="submit" disabled={pending} className={dangerButtonClass}>
        {pending ? 'Stopping' : 'Stop kiosk'}
      </button>
      <button
        type="button"
        className={secondaryButtonClass}
        onClick={() => {
          setConfirming(false);
        }}
      >
        Keep it
      </button>
    </form>
  );
}
