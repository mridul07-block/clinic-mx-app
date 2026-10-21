'use client';

import { useActionState } from 'react';
import {
  FormMessage,
  TextAreaField,
  TextField,
  dangerButtonClass,
  primaryButtonClass,
  secondaryButtonClass,
} from '../../../../../components/forms';
import {
  addSupportLoginAction,
  endSupportAction,
  grantSupportAction,
  type SupportFormState,
} from '../../../../../modules/support/actions';
import { InviteLink } from '../staff/staff-fields';

const initialState: SupportFormState = {};

function Messages({ state }: { state: SupportFormState }) {
  return (
    <>
      {state.error ? <FormMessage tone="danger">{state.error}</FormMessage> : null}
      {state.notice ? <FormMessage tone="info">{state.notice}</FormMessage> : null}
    </>
  );
}

/** Turns support access on from now, for whole hours up to the setting, with a reason (IAM-08). */
export function GrantForm({ maxHours }: { maxHours: number }) {
  const [state, action, pending] = useActionState(grantSupportAction, initialState);
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <Messages state={state} />
      <TextField
        label="Hours"
        name="hours"
        type="number"
        inputMode="numeric"
        min={1}
        max={maxHours}
        step={1}
        defaultValue={state.values?.hours ?? '1'}
        helper={`From now, up to ${maxHours} hours.`}
        error={state.fieldErrors?.hours}
      />
      <TextAreaField
        label="Reason"
        name="reason"
        maxLength={500}
        defaultValue={state.values?.reason}
        helper="What Velyx support needs it for. It is kept with the grant."
        error={state.fieldErrors?.reason}
      />
      <button type="submit" disabled={pending} className={primaryButtonClass}>
        {pending ? 'Granting' : 'Grant support access'}
      </button>
    </form>
  );
}

/** Ends support access now; support logins are signed out on every device. */
export function EndAccessForm({ grantId }: { grantId: string }) {
  const [state, action, pending] = useActionState(endSupportAction, initialState);
  return (
    <form action={action} className="flex flex-col gap-3">
      <Messages state={state} />
      <input type="hidden" name="grantId" value={grantId} />
      <button type="submit" disabled={pending} className={dangerButtonClass}>
        End support access now
      </button>
    </form>
  );
}

/** Adds a Velyx support login, invited by email or with a link to share. */
export function AddSupportLoginForm() {
  const [state, action, pending] = useActionState(addSupportLoginAction, initialState);
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <Messages state={state} />
      {state.inviteLink ? <InviteLink link={state.inviteLink} /> : null}
      <TextField
        label="Email"
        name="email"
        type="email"
        autoComplete="off"
        defaultValue={state.values?.email}
        helper="The Velyx team member signs in with this email."
        error={state.fieldErrors?.email}
      />
      <TextField
        label="Name"
        name="name"
        autoComplete="off"
        defaultValue={state.values?.name}
        error={state.fieldErrors?.name}
      />
      <button type="submit" disabled={pending} className={secondaryButtonClass}>
        {pending ? 'Adding' : 'Add support login'}
      </button>
    </form>
  );
}
