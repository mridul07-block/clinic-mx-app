'use client';

import { aiDispositionLabels, type AiDisposition } from '@clinic-mx/schemas';
import { useActionState } from 'react';
import { FormMessage } from '../../../../../../../components/forms';
import {
  recordDispositionAction,
  type DispositionState,
} from '../../../../../../../modules/ai/actions';

const initialState: DispositionState = {};

const buttonClass =
  'inline-flex min-h-11 flex-1 items-center justify-center rounded-control border px-3.5 font-medium transition-colors duration-[var(--duration-quick)] disabled:text-ink-faint md:flex-none';

/**
 * Keep or Dismiss one suggestion (AI-03; Frontend Specification "AI suggestion card"). Only the
 * visit's consultant sees the buttons; others read what was chosen.
 */
export function DispositionButtons({
  suggestionId,
  episodeId,
  disposition,
  canDispose,
}: {
  suggestionId: string;
  episodeId: string;
  disposition: AiDisposition | null;
  canDispose: boolean;
}) {
  const [state, action, pending] = useActionState(recordDispositionAction, initialState);
  if (!canDispose) {
    return disposition ? (
      <p className="text-sm text-ink-secondary" data-testid="suggestion-disposition">
        {aiDispositionLabels[disposition]}
      </p>
    ) : null;
  }
  return (
    <form action={action} className="flex flex-col gap-2">
      <input type="hidden" name="suggestionId" value={suggestionId} />
      <input type="hidden" name="episodeId" value={episodeId} />
      <div className="flex gap-2">
        <button
          type="submit"
          name="disposition"
          value="kept"
          aria-pressed={disposition === 'kept'}
          disabled={pending}
          className={`${buttonClass} ${
            disposition === 'kept'
              ? 'border-transparent bg-accent text-on-accent'
              : 'border-line-control bg-surface text-ink hover:bg-surface-hover'
          }`}
        >
          {disposition === 'kept' ? 'Kept' : 'Keep'}
        </button>
        <button
          type="submit"
          name="disposition"
          value="dismissed"
          aria-pressed={disposition === 'dismissed'}
          disabled={pending}
          className={`${buttonClass} ${
            disposition === 'dismissed'
              ? 'border-transparent bg-ink text-surface'
              : 'border-line-control bg-surface text-ink hover:bg-surface-hover'
          }`}
        >
          {disposition === 'dismissed' ? 'Dismissed' : 'Dismiss'}
        </button>
      </div>
      {state.error ? <FormMessage tone="danger">{state.error}</FormMessage> : null}
    </form>
  );
}
