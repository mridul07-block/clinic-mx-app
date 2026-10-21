'use client';

import { useActionState } from 'react';
import { FormMessage, primaryButtonClass } from '../../../../../../components/forms';
import { updateStaffAction, type StaffFormState } from '../../../../../../modules/staff/actions';
import { StaffFields, type StaffFieldDefaults } from '../staff-fields';

const initialState: StaffFormState = {};

interface EditFormProps {
  staffUserId: string;
  centres: { id: string; name: string }[];
  defaults: StaffFieldDefaults;
  roleLocked: boolean;
}

export function EditForm({ staffUserId, centres, defaults, roleLocked }: EditFormProps) {
  const [state, action, pending] = useActionState(updateStaffAction, initialState);
  return (
    <form action={action} className="flex flex-col gap-5" noValidate>
      {state.error ? <FormMessage tone="danger">{state.error}</FormMessage> : null}
      {state.notice ? <FormMessage tone="info">{state.notice}</FormMessage> : null}
      <input type="hidden" name="staffUserId" value={staffUserId} />
      <StaffFields
        centres={centres}
        defaults={defaults}
        fieldErrors={state.fieldErrors}
        roleLocked={roleLocked}
      />
      <button type="submit" disabled={pending} className={primaryButtonClass}>
        {pending ? 'Saving' : 'Save changes'}
      </button>
    </form>
  );
}
