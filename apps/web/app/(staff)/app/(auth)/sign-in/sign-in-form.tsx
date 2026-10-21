'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { FormMessage, TextField, primaryButtonClass } from '../../../../../components/forms';
import { signIn, type AuthFormState } from '../../../../../modules/auth/actions';
import { PasswordInput } from '../password-input';

const initialState: AuthFormState = {};

export function SignInForm({ next, passwordChanged }: { next: string; passwordChanged: boolean }) {
  const [state, action, pending] = useActionState(signIn, initialState);
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      {state.error ? (
        <FormMessage tone="danger">{state.error}</FormMessage>
      ) : passwordChanged ? (
        <FormMessage tone="info">Password changed. Sign in with your new password.</FormMessage>
      ) : null}
      <input type="hidden" name="next" value={next} />
      <TextField
        label="Email"
        name="email"
        type="email"
        autoComplete="username"
        inputMode="email"
        required
        defaultValue={state.email}
      />
      <PasswordInput label="Password" autoComplete="current-password" />
      <button type="submit" disabled={pending} className={primaryButtonClass}>
        {pending ? 'Signing in' : 'Sign in'}
      </button>
      <Link
        href="/app/forgot-password"
        className="self-start text-accent underline underline-offset-2 pointer-coarse:py-3"
      >
        Forgot password?
      </Link>
    </form>
  );
}
