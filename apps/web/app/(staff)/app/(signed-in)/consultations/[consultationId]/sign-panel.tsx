'use client';

import { useActionState, useState } from 'react';
import { primaryButtonClass, secondaryButtonClass } from '../../../../../../components/forms';
import {
  signConsultationAction,
  type ConsultationFormState,
} from '../../../../../../modules/consultations/actions';

const initialState: ConsultationFormState = {};

/**
 * Sign and finish (CLN-09, user decision 24 October 2026): saves what is left, then asks once,
 * since signing cannot be undone. The server signs only at the version just saved, after the same
 * gates, with the Treats patients tick read at that moment.
 */
export function SignPanel({
  consultationId,
  blocked,
  saveNow,
}: {
  consultationId: string;
  /** Something still holds signing back (the gate above says what). */
  blocked: boolean;
  saveNow: () => Promise<number | undefined>;
}) {
  const [state, action, pending] = useActionState(signConsultationAction, initialState);
  const [version, setVersion] = useState<number>();
  const [saving, setSaving] = useState(false);
  const [unsaved, setUnsaved] = useState(false);

  const start = async () => {
    setSaving(true);
    setUnsaved(false);
    const saved = await saveNow();
    setSaving(false);
    if (saved === undefined) setUnsaved(true);
    else setVersion(saved);
  };

  return (
    <div className="flex flex-col gap-3">
      {version === undefined ? (
        <button
          type="button"
          disabled={blocked || saving}
          onClick={() => void start()}
          className={`${primaryButtonClass} md:w-auto md:self-start`}
        >
          {saving ? 'Saving…' : 'Sign and finish'}
        </button>
      ) : (
        <div
          data-testid="sign-confirm"
          className="flex flex-col gap-3 rounded-panel border border-line-strong bg-surface px-3 py-3"
        >
          <p className="font-medium">Signing locks this consultation. Later changes are addenda.</p>
          <form action={action} className="flex flex-col gap-2 md:flex-row">
            <input type="hidden" name="consultationId" value={consultationId} />
            <input type="hidden" name="baseVersion" value={version} />
            <button type="submit" disabled={pending} className={`${primaryButtonClass} md:w-auto`}>
              {pending ? 'Signing…' : 'Sign'}
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => {
                setVersion(undefined);
              }}
              className={`${secondaryButtonClass} md:w-auto`}
            >
              Keep editing
            </button>
          </form>
        </div>
      )}
      {unsaved ? (
        <p className="text-sm text-danger">
          Your latest changes are not saved yet. Check the connection and try again.
        </p>
      ) : null}
      {state.error ? <p className="text-sm text-danger">{state.error}</p> : null}
    </div>
  );
}
