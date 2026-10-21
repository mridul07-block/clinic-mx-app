'use client';

import { useActionState } from 'react';
import { secondaryButtonClass } from '../../../../../../components/forms';
import { tryWriteAction } from './actions';

/** Posts a write for the action and shows what the server answered (end to end tests only). */
export function TryWrite({ action }: { action: string }) {
  const [result, submit, pending] = useActionState(tryWriteAction, '');
  return (
    <form action={submit} className="flex flex-col gap-3">
      <input type="hidden" name="action" value={action} />
      <button type="submit" disabled={pending} className={secondaryButtonClass}>
        Try a write
      </button>
      {result ? <p role="status">{result}</p> : null}
    </form>
  );
}
