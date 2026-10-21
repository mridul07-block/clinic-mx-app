'use client';

import { PASSWORD_MIN_LENGTH } from '@clinic-mx/schemas';
import Link from 'next/link';
import { useActionState } from 'react';
import { FormMessage, primaryButtonClass } from '../../../../../components/forms';
import { resetPassword, type AuthFormState } from '../../../../../modules/auth/actions';
import { CodeInput } from '../code-input';
import { PasswordInput } from '../password-input';

const initialState: AuthFormState = {};

export function ResetPasswordForm({ tokenHash, invite }: { tokenHash: string; invite: boolean }) {
  const [state, action, pending] = useActionState(resetPassword, initialState);
  if (!tokenHash || state.linkExpired) {
    // An invite link is replaced by the Super Admin, not by the forgot password page.
    return invite ? (
      <FormMessage tone="danger">
        This invite link has expired or was already used. Ask your Super Admin to send the invite
        again.
      </FormMessage>
    ) : (
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
      <input type="hidden" name="linkType" value={invite ? 'invite' : 'recovery'} />
      <PasswordInput
        label={invite ? 'Password' : 'New password'}
        autoComplete="new-password"
        helper={`At least ${String(PASSWORD_MIN_LENGTH)} characters.`}
      />
      {/* Accounts with two step verification also need a code (IAM-02). */}
      {state.needCode ? <CodeInput label="Code from your authenticator app" /> : null}
      <button type="submit" disabled={pending} className={primaryButtonClass}>
        {pending ? 'Saving' : 'Save password'}
      </button>
    </form>
  );
}
