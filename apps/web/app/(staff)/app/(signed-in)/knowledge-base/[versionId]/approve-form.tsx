'use client';

import { useActionState, useId } from 'react';
import { FormMessage, TextAreaField, primaryButtonClass } from '../../../../../../components/forms';
import {
  approveVersionAction,
  type ApproveVersionState,
} from '../../../../../../modules/knowledge-base/actions';

/**
 * The Super Admin approves a draft (SET-06): an optional note, a confirmation that they have read
 * the import report, then the button. New records take the version from then on.
 */
export function ApproveForm({ versionId, number }: { versionId: string; number: number }) {
  const [state, action, pending] = useActionState<ApproveVersionState, FormData>(
    approveVersionAction,
    {},
  );
  const confirmId = useId();
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <input type="hidden" name="versionId" value={versionId} />
      {state.error ? <FormMessage tone="danger">{state.error}</FormMessage> : null}
      <TextAreaField
        label="Note (optional)"
        name="notes"
        defaultValue={state.values?.notes}
        maxLength={1000}
        helper="Kept with the version, for example what you checked."
      />
      <label
        htmlFor={confirmId}
        className="flex min-h-11 items-start gap-3 rounded-control border border-line-control bg-surface p-3 text-ink"
      >
        <input
          id={confirmId}
          type="checkbox"
          name="confirmed"
          defaultChecked={state.values?.confirmed}
          className="mt-1 size-5 shrink-0"
        />
        <span>
          I have read the import report. New consultations and session notes will use version{' '}
          {number}; records already started keep their version.
        </span>
      </label>
      <button type="submit" className={primaryButtonClass} disabled={pending}>
        Approve version {number}
      </button>
    </form>
  );
}
