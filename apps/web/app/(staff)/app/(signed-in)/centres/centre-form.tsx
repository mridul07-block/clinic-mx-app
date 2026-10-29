'use client';

import { centreColours, formatIndianPhone } from '@clinic-mx/schemas';
import { useActionState, useId, useState } from 'react';
import {
  FormMessage,
  TextAreaField,
  TextField,
  dangerButtonClass,
  primaryButtonClass,
  secondaryButtonClass,
} from '../../../../../components/forms';
import {
  addCentreAction,
  editCentreAction,
  setCentreActiveAction,
  type CentreFormState,
} from '../../../../../modules/centres/actions';
import { swatchClass } from './centre-swatch';

const initialState: CentreFormState = {};

const choiceClass =
  'flex min-h-row items-center gap-3 rounded-control px-1 text-ink pointer-coarse:min-h-row-touch';

export interface CentreFormValues {
  centreId?: string;
  name: string;
  address: string;
  phone: string;
  mapLink: string;
  /** PAT-09: the centre's Google review link. */
  reviewLink: string;
  colour: string;
  /** Zero Gravity Treadmills, as typed. */
  treadmills: string;
}

/**
 * A centre's details (SET-01). The chart colour is chosen from the design system's centre
 * colours; one used by another active centre is shown with who has it and cannot be chosen.
 */
export function CentreForm({
  centre,
  takenBy,
  inactive = false,
}: {
  centre?: CentreFormValues;
  /** Colour value to the name of the other active centre using it. */
  takenBy: Record<string, string>;
  /** An inactive centre may keep or choose a used colour; it must be free to reactivate. */
  inactive?: boolean;
}) {
  const [state, action, pending] = useActionState(
    centre?.centreId ? editCentreAction : addCentreAction,
    initialState,
  );
  const id = useId();
  const value = (field: keyof CentreFormValues) =>
    state.values?.[field] ??
    (field === 'phone' && centre?.phone ? formatIndianPhone(centre.phone) : centre?.[field]) ??
    '';
  const chosen = state.values?.colour ?? centre?.colour;
  const firstFree = centreColours.find((colour) => !takenBy[colour.value])?.value;

  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      {state.error ? <FormMessage tone="danger">{state.error}</FormMessage> : null}
      {centre?.centreId ? <input type="hidden" name="centreId" value={centre.centreId} /> : null}
      <TextField
        label="Name"
        name="name"
        autoComplete="off"
        maxLength={60}
        defaultValue={value('name')}
        error={state.fieldErrors?.name}
      />
      {centre?.centreId ? null : (
        <TextField
          label="Code"
          name="code"
          autoComplete="off"
          autoCapitalize="characters"
          maxLength={4}
          defaultValue={state.values?.code ?? ''}
          helper="2 to 4 letters, for example HSR. It starts every OP number the centre issues and cannot be changed later."
          error={state.fieldErrors?.code}
        />
      )}
      {centre?.centreId ? null : (
        <TextField
          label="Appointment prefix"
          name="appointmentPrefix"
          autoComplete="off"
          autoCapitalize="characters"
          maxLength={4}
          defaultValue={state.values?.appointmentPrefix ?? ''}
          helper="2 to 4 letters, for example MVH. It starts every appointment ID the centre issues and cannot be changed later."
          error={state.fieldErrors?.appointmentPrefix}
        />
      )}
      <TextAreaField
        label="Address"
        name="address"
        maxLength={300}
        defaultValue={value('address')}
        helper="As patients should see it in messages and on receipts."
        error={state.fieldErrors?.address}
      />
      <TextField
        label="Phone"
        name="phone"
        type="tel"
        inputMode="tel"
        autoComplete="off"
        defaultValue={value('phone')}
        helper="The front desk number patients call, for example 080 4123 4567."
        error={state.fieldErrors?.phone}
      />
      <TextField
        label="Map link"
        name="mapLink"
        type="url"
        inputMode="url"
        autoComplete="off"
        defaultValue={value('mapLink')}
        helper="In Google Maps, open the centre, choose Share and copy the link."
        error={state.fieldErrors?.mapLink}
      />
      <TextField
        label="Google review link (optional)"
        name="reviewLink"
        type="url"
        inputMode="url"
        autoComplete="off"
        defaultValue={value('reviewLink')}
        helper="Sent to every patient at discharge. In the centre's Google Business Profile, choose Ask for reviews and copy the link."
        error={state.fieldErrors?.reviewLink}
      />
      <TextField
        label="Zero Gravity Treadmills"
        name="treadmills"
        type="number"
        inputMode="numeric"
        min={0}
        max={20}
        autoComplete="off"
        defaultValue={value('treadmills') || '1'}
        helper="How many the centre has. Each treadmill takes one booking at a time."
        error={state.fieldErrors?.treadmills}
      />
      <fieldset
        className="flex flex-col gap-1"
        aria-describedby={state.fieldErrors?.colour ? `${id}-colour-error` : `${id}-colour-helper`}
      >
        <legend className="mb-1 font-medium text-ink">Chart colour</legend>
        {centreColours.map((colour, index) => {
          const holder = takenBy[colour.value];
          return (
            <label key={colour.value} className={choiceClass}>
              <input
                type="radio"
                name="colour"
                value={colour.value}
                disabled={Boolean(holder) && !inactive}
                defaultChecked={(chosen ?? firstFree) === colour.value}
                className="size-4 accent-accent"
              />
              <span
                aria-hidden="true"
                className={`size-4 rounded-full border border-line ${swatchClass[index] ?? ''}`}
              />
              <span>
                {colour.name}
                {holder ? <span className="text-ink-muted"> (used by {holder})</span> : null}
              </span>
            </label>
          );
        })}
        <p id={`${id}-colour-helper`} className="text-sm text-ink-muted">
          Marks the centre in charts. Each colour belongs to one active centre.
        </p>
        {state.fieldErrors?.colour ? (
          <p id={`${id}-colour-error`} className="text-sm text-danger">
            {state.fieldErrors.colour}
          </p>
        ) : null}
      </fieldset>
      <button type="submit" disabled={pending} className={primaryButtonClass}>
        {pending ? 'Saving' : centre?.centreId ? 'Save centre' : 'Add centre'}
      </button>
    </form>
  );
}

/**
 * Deactivates a centre after a confirm step (staff assignments, tablets and history stay), or
 * reactivates it.
 */
export function CentreActiveForm({
  centreId,
  name,
  active,
}: {
  centreId: string;
  name: string;
  active: boolean;
}) {
  const [state, action, pending] = useActionState(setCentreActiveAction, initialState);
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
        Deactivate centre
      </button>
    );
  }
  return (
    <form action={action} className="flex flex-col gap-3">
      {state.error ? <FormMessage tone="danger">{state.error}</FormMessage> : null}
      <input type="hidden" name="centreId" value={centreId} />
      <input type="hidden" name="active" value={active ? 'false' : 'true'} />
      {active ? (
        <>
          <p className="text-ink-secondary">
            Deactivate {name}? It is no longer offered for new staff or tablets, and its colour is
            freed. Its staff, tablets and history stay.
          </p>
          <button type="submit" disabled={pending} className={dangerButtonClass}>
            {pending ? 'Deactivating' : 'Deactivate centre'}
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
          {pending ? 'Reactivating' : 'Reactivate centre'}
        </button>
      )}
    </form>
  );
}
