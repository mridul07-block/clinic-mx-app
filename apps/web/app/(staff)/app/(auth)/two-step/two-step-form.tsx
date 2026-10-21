'use client';

import { useActionState } from 'react';
import { FormMessage, primaryButtonClass } from '../../../../../components/forms';
import type { AuthFormState } from '../../../../../modules/auth/actions';
import { verifyTwoStep } from '../../../../../modules/auth/two-step-actions';
import { CodeInput } from '../code-input';

const initialState: AuthFormState = {};

export function TwoStepForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState(verifyTwoStep, initialState);
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      {state.error ? <FormMessage tone="danger">{state.error}</FormMessage> : null}
      <input type="hidden" name="next" value={next} />
      <CodeInput />
      <button type="submit" disabled={pending} className={primaryButtonClass}>
        {pending ? 'Checking' : 'Verify'}
      </button>
    </form>
  );
}
