'use client';

import { maskNumber } from '@clinic-mx/schemas';
import Link from 'next/link';
import { useActionState, useId } from 'react';
import { FormMessage, primaryButtonClass } from '../../../../../components/forms';
import {
  sendTestMessageAction,
  type TestMessageState,
} from '../../../../../modules/messaging/actions';

const initialState: TestMessageState = {};

const controlClass =
  'h-row w-full rounded-control border border-line-control bg-surface px-3 text-ink shadow-xs hover:border-ink-muted pointer-coarse:h-row-touch';

/**
 * A test WhatsApp message (WA-01): Meta's "hello_world" sample to a number on the test list,
 * proving the connection end to end. The job tick sends it within a minute.
 */
export function TestMessageForm({ recipients }: { recipients: string[] }) {
  const [state, action, pending] = useActionState(sendTestMessageAction, initialState);
  const fieldId = useId();
  if (recipients.length === 0) {
    return (
      <p className="text-ink-secondary" data-testid="no-test-recipients">
        Add your verified number under{' '}
        <Link href="/app/settings" className="text-accent underline underline-offset-2">
          Settings
        </Link>{' '}
        → WhatsApp → test recipients first.
      </p>
    );
  }
  return (
    <form action={action} className="flex flex-col gap-3">
      <label htmlFor={fieldId} className="font-medium text-ink">
        Send to
      </label>
      <select id={fieldId} name="to" required className={controlClass}>
        {recipients.map((number) => (
          <option key={number} value={number}>
            {maskNumber(number)}
          </option>
        ))}
      </select>
      <button
        type="submit"
        disabled={pending}
        className={`${primaryButtonClass} md:w-auto md:self-start`}
      >
        {pending ? 'Queuing…' : 'Send test message'}
      </button>
      {state.error ? <FormMessage tone="danger">{state.error}</FormMessage> : null}
      {state.notice ? <FormMessage tone="info">{state.notice}</FormMessage> : null}
    </form>
  );
}
