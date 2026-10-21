'use client';

import { useState, useTransition } from 'react';
import { primaryButtonClass } from '../../../../components/forms';
import { draftSavers } from '../../../../lib/drafts/savers';
import { clearDrafts, listDrafts } from '../../../../lib/drafts/store';
import { flushDrafts } from '../../../../lib/drafts/sync';
import { useDraftScope } from '../../../../lib/drafts/use-autosave';
import { signOut } from '../../../../modules/auth/actions';

/**
 * Signs out and deletes this person's drafts from the device, so the next person on a shared
 * phone or tablet never sees them. Drafts are saved first; any that cannot be saved (offline, or
 * in conflict) are only deleted after the person agrees.
 */
export function SignOutButton() {
  const scope = useDraftScope();
  const [unsaved, setUnsaved] = useState(0);
  const [pending, startTransition] = useTransition();

  const finish = () => {
    startTransition(async () => {
      await clearDrafts(scope);
      await signOut();
    });
  };

  const start = () => {
    startTransition(async () => {
      if (navigator.onLine) await flushDrafts(scope, draftSavers);
      const left = (await listDrafts(scope)).length;
      if (left > 0) setUnsaved(left);
      else {
        await clearDrafts(scope);
        await signOut();
      }
    });
  };

  if (unsaved > 0) {
    return (
      <div
        role="alert"
        className="flex flex-col gap-3 rounded-panel border border-waiting-line bg-waiting-soft p-4"
      >
        <p className="text-ink">
          {unsaved === 1 ? '1 change is' : `${String(unsaved)} changes are`} not saved yet. Signing
          out deletes {unsaved === 1 ? 'it' : 'them'} from this device.
        </p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              setUnsaved(0);
            }}
            className={primaryButtonClass}
          >
            Stay signed in
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={finish}
            className="inline-flex h-row w-full items-center justify-center rounded-control border border-line-strong bg-surface px-3.5 font-medium text-danger shadow-xs transition-colors duration-[var(--duration-quick)] hover:border-danger-line hover:bg-danger-soft pointer-coarse:h-row-touch"
          >
            {pending ? 'Signing out' : 'Sign out and delete them'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <button type="button" disabled={pending} onClick={start} className={primaryButtonClass}>
      {pending ? 'Signing out' : 'Sign out'}
    </button>
  );
}
