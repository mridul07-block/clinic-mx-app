'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { FormMessage, TextField, primaryButtonClass } from '../../../../../components/forms';
import { requestPasswordReset, type AuthFormState } from '../../../../../modules/auth/actions';

const initialState: AuthFormState = {};

const backLink = 'self-start text-accent underline underline-offset-2 pointer-coarse:py-3';

export function ForgotPasswordForm() {
  const [state, action, pending] = useActionState(requestPasswordReset, initialState);
  if (state.sent) {
    return (
      <div className="flex flex-col gap-4">
        <FormMessage tone="info">
          If {state.email} has a staff account, a reset link is on its way. Check your email.
        </FormMessage>
        <Link href="/app/sign-in" className={backLink}>
          Back to sign in
        </Link>
      </div>
    );
  }
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      {state.error ? <FormMessage tone="danger">{state.error}</FormMessage> : null}
      <TextField
        label="Email"
        name="email"
        type="email"
        autoComplete="username"
        inputMode="email"
        required
        defaultValue={state.email}
      />
      <button type="submit" disabled={pending} className={primaryButtonClass}>
        {pending ? 'Sending' : 'Send reset link'}
      </button>
      <Link href="/app/sign-in" className={backLink}>
        Back to sign in
      </Link>
    </form>
  );
}
