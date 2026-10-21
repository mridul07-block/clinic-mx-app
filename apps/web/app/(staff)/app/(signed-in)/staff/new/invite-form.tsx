'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { FormMessage, TextField, primaryButtonClass } from '../../../../../../components/forms';
import { inviteStaffAction, type StaffFormState } from '../../../../../../modules/staff/actions';
import { InviteLink, StaffFields } from '../staff-fields';

const initialState: StaffFormState = {};

export function InviteForm({ centres }: { centres: { id: string; name: string }[] }) {
  const [state, action, pending] = useActionState(inviteStaffAction, initialState);
  if (state.inviteLink && state.staffUserId) {
    return (
      <div className="flex flex-col gap-4">
        <FormMessage tone="info">{state.notice}</FormMessage>
        <InviteLink link={state.inviteLink} />
        <Link href={`/app/staff/${state.staffUserId}`} className={primaryButtonClass}>
          Open their staff page
        </Link>
      </div>
    );
  }
  return (
    <form action={action} className="flex flex-col gap-5" noValidate>
      {state.error ? <FormMessage tone="danger">{state.error}</FormMessage> : null}
      <TextField
        label="Email"
        name="email"
        type="email"
        autoComplete="off"
        helper="They sign in with this email. It cannot be changed later."
        error={state.fieldErrors?.email}
      />
      <StaffFields
        centres={centres}
        fieldErrors={state.fieldErrors}
        defaults={{
          name: '',
          role: 'front_desk',
          treatsPatients: false,
          consultant: false,
          centreIds: [],
          accessEndsOn: '',
        }}
      />
      <button type="submit" disabled={pending} className={primaryButtonClass}>
        {pending ? 'Sending' : 'Send invite'}
      </button>
    </form>
  );
}
