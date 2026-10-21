'use client';

import { DESKTOP_MEDIA_QUERY, type SessionEndReason } from '@clinic-mx/schemas';
import Link from 'next/link';
import { useActionState, useSyncExternalStore } from 'react';
import { FormMessage, TextField, primaryButtonClass } from '../../../../../components/forms';
import { signIn, type AuthFormState } from '../../../../../modules/auth/actions';
import { PasswordInput } from '../password-input';

const initialState: AuthFormState = {};

/** Why the last session ended, in words (IAM-07). */
function endedMessage(reason: SessionEndReason, idleMinutes: number): string {
  switch (reason) {
    case 'idle':
      return `You were signed out after ${String(idleMinutes)} minutes without activity. Sign in again to go on.`;
    case 'expired':
      return 'Your session on this phone has ended. Sign in again to go on.';
    case 'ended':
      return 'Your session ended. Sign in again to go on.';
  }
}

/** Decision G7: a fine pointer and at least 1024 px wide is a desktop, everything else a phone. */
function useDeviceClass(): 'desktop' | 'phone' {
  return useSyncExternalStore(
    (onChange) => {
      const query = window.matchMedia(DESKTOP_MEDIA_QUERY);
      query.addEventListener('change', onChange);
      return () => {
        query.removeEventListener('change', onChange);
      };
    },
    () => (window.matchMedia(DESKTOP_MEDIA_QUERY).matches ? 'desktop' : 'phone'),
    () => 'desktop',
  );
}

interface SignInFormProps {
  next: string;
  passwordChanged: boolean;
  ended?: SessionEndReason;
  idleMinutes: number;
}

export function SignInForm({ next, passwordChanged, ended, idleMinutes }: SignInFormProps) {
  const [state, action, pending] = useActionState(signIn, initialState);
  const device = useDeviceClass();
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      {state.error ? (
        <FormMessage tone="danger">{state.error}</FormMessage>
      ) : passwordChanged ? (
        <FormMessage tone="info">Password changed. Sign in with your new password.</FormMessage>
      ) : ended ? (
        <FormMessage tone="info">{endedMessage(ended, idleMinutes)}</FormMessage>
      ) : null}
      <input type="hidden" name="next" value={next} />
      <input type="hidden" name="device" value={device} />
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
