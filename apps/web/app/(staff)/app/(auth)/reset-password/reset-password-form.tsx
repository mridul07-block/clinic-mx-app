'use client';

import { PASSWORD_MIN_LENGTH } from '@clinic-mx/schemas';
import Link from 'next/link';
import { useActionState } from 'react';
import { FormMessage, primaryButtonClass } from '../../../../../components/forms';
import { resetPassword, type AuthFormState } from '../../../../../modules/auth/actions';
import { PasswordInput } from '../password-input';

const initialState: AuthFormState = {};

export function ResetPasswordForm({ tokenHash }: { tokenHash: string }) {
  const [state, action, pending] = useActionState(resetPassword, initialState);
  if (!tokenHash || state.linkExpired) {
    return (
      <div className="flex flex-col gap-4">
        <FormMessage tone="danger">
          {state.error ?? 'This reset link is not complete. Ask for a new one.'}
        </FormMessage>
        <Link href="/app/forgot-password" className={primaryButtonClass}>
          Ask for a new link
        </Link>
      </div>
    );
  }
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      {state.error ? <FormMessage tone="danger">{state.error}</FormMessage> : null}
      <input type="hidden" name="tokenHash" value={tokenHash} />
      <PasswordInput
        label="New password"
        autoComplete="new-password"
        helper={`At least ${String(PASSWORD_MIN_LENGTH)} characters.`}
      />
      <button type="submit" disabled={pending} className={primaryButtonClass}>
        {pending ? 'Saving' : 'Save password'}
      </button>
    </form>
  );
}
