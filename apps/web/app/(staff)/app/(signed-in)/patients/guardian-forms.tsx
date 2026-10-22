'use client';

import {
  formatIndianPhone,
  guardianRelationshipLabels,
  guardianRelationships,
} from '@clinic-mx/schemas';
import { useActionState, useId, useState } from 'react';
import {
  FormMessage,
  TextField,
  dangerButtonClass,
  primaryButtonClass,
  secondaryButtonClass,
} from '../../../../../components/forms';
import {
  addGuardianAction,
  editGuardianAction,
  removeGuardianAction,
  type GuardianFormState,
} from '../../../../../modules/patients/actions';

const initialState: GuardianFormState = {};

const selectClass =
  'h-row w-full rounded-control border border-line-control bg-surface px-3 text-ink shadow-xs aria-invalid:border-danger pointer-coarse:h-row-touch';

/**
 * Adds a guardian, or edits one (SCH-02): name, relationship from the fixed list, and a mobile,
 * preset with the patient's own for a new guardian.
 */
export function GuardianForm({
  patientId,
  guardian,
  defaultPhone,
}: {
  patientId: string;
  guardian?: { id: string; name: string; relationship: string; phone: string };
  /** The patient's mobile, offered for a new guardian. */
  defaultPhone?: string;
}) {
  const [state, action, pending] = useActionState(
    guardian ? editGuardianAction : addGuardianAction,
    initialState,
  );
  const id = useId();
  const errors = state.fieldErrors ?? {};
  const phone = guardian?.phone ?? defaultPhone;
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      {state.error ? <FormMessage tone="danger">{state.error}</FormMessage> : null}
      <input type="hidden" name="patientId" value={patientId} />
      {guardian ? <input type="hidden" name="guardianId" value={guardian.id} /> : null}
      <TextField
        label="Guardian’s name"
        name="name"
        autoComplete="off"
        maxLength={100}
        defaultValue={state.values?.name ?? guardian?.name ?? ''}
        error={errors.name}
      />
      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${id}-relationship`} className="font-medium text-ink">
          Relationship
        </label>
        <select
          id={`${id}-relationship`}
          name="relationship"
          defaultValue={state.values?.relationship ?? guardian?.relationship ?? ''}
          aria-invalid={errors.relationship ? true : undefined}
          className={selectClass}
        >
          <option value="" disabled>
            Choose
          </option>
          {guardianRelationships.map((relationship) => (
            <option key={relationship} value={relationship}>
              {guardianRelationshipLabels[relationship]}
            </option>
          ))}
        </select>
        {errors.relationship ? <p className="text-sm text-danger">{errors.relationship}</p> : null}
      </div>
      <TextField
        label="Guardian’s mobile"
        name="phone"
        type="tel"
        inputMode="tel"
        autoComplete="off"
        defaultValue={state.values?.phone ?? (phone ? formatIndianPhone(phone) : '')}
        helper={
          guardian ? undefined : 'Starts as the patient’s mobile; change it if theirs differs.'
        }
        error={errors.phone}
      />
      <button type="submit" disabled={pending} className={primaryButtonClass}>
        {pending ? 'Saving' : guardian ? 'Save guardian' : 'Add guardian'}
      </button>
    </form>
  );
}

/** Removes a guardian after a confirm step; they stay on record for consents they signed. */
export function RemoveGuardianForm({
  patientId,
  guardianId,
  name,
}: {
  patientId: string;
  guardianId: string;
  name: string;
}) {
  const [state, action, pending] = useActionState(removeGuardianAction, initialState);
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
        Remove {name}
      </button>
    );
  }
  return (
    <form action={action} className="flex flex-col gap-3">
      {state.error ? <FormMessage tone="danger">{state.error}</FormMessage> : null}
      <input type="hidden" name="patientId" value={patientId} />
      <input type="hidden" name="guardianId" value={guardianId} />
      <p className="text-ink-secondary">
        Remove {name} as a guardian? They are kept on record for any consent they signed.
      </p>
      <button type="submit" disabled={pending} className={dangerButtonClass}>
        {pending ? 'Removing' : 'Remove guardian'}
      </button>
      <button
        type="button"
        className={secondaryButtonClass}
        onClick={() => {
          setConfirming(false);
        }}
      >
        Keep {name}
      </button>
    </form>
  );
}
