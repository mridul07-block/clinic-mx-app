'use client';

import { ADDENDUM_MAX, formatIstDateTime } from '@clinic-mx/schemas';
import { useActionState, useId } from 'react';
import { primaryButtonClass } from '../../../../../../components/forms';
import { addAddendumAction } from '../../../../../../modules/consultations/actions';
import { addSessionAddendumAction } from '../../../../../../modules/sessions/actions';

const initialState: { error?: string; notice?: string } = {};

export interface AddendumView {
  id: string;
  text: string;
  authorName: string;
  createdAt: Date;
}

/** The signed note an addendum belongs to. */
export type AddendumTarget = { consultationId: string } | { sessionId: string };

/**
 * A signed note's addenda (CLN-09, PRD J3.9): written after signing, never changed, each with who
 * wrote it and when; clinicians who may add one do it here, on the consultation, on the session
 * screen (CLN-12 follow up) or on the patient record's Notes (CLN-12, `patientId` given).
 */
export function Addenda({
  target,
  addenda,
  adds,
  patientId,
}: {
  target: AddendumTarget;
  addenda: AddendumView[];
  adds: boolean;
  patientId?: string;
}) {
  const [state, action, pending] = useActionState(
    'sessionId' in target ? addSessionAddendumAction : addAddendumAction,
    initialState,
  );
  const fieldId = useId();
  return (
    <section aria-labelledby={[fieldId, 'title'].join('-')} className="flex flex-col gap-3">
      <h3 id={[fieldId, 'title'].join('-')} className="text-md font-semibold">
        Addenda
      </h3>
      {addenda.length > 0 ? (
        <ol className="flex flex-col divide-y divide-line rounded-panel border border-line">
          {addenda.map((entry) => (
            <li key={entry.id} data-testid="addendum" className="flex flex-col gap-1 px-3 py-2.5">
              <p className="text-sm text-ink-muted">
                {entry.authorName} · {formatIstDateTime(entry.createdAt)}
              </p>
              <p className="whitespace-pre-wrap">{entry.text}</p>
            </li>
          ))}
        </ol>
      ) : (
        <p className="text-sm text-ink-muted">No addenda.</p>
      )}
      {adds ? (
        // A fresh form after each addendum, so the box empties.
        <form key={addenda.length} action={action} className="flex flex-col gap-2">
          {'sessionId' in target ? (
            <input type="hidden" name="sessionId" value={target.sessionId} />
          ) : (
            <input type="hidden" name="consultationId" value={target.consultationId} />
          )}
          {patientId ? <input type="hidden" name="patientId" value={patientId} /> : null}
          <label htmlFor={fieldId} className="font-medium">
            Add addendum
          </label>
          <textarea
            id={fieldId}
            name="text"
            required
            maxLength={ADDENDUM_MAX}
            rows={4}
            className="w-full rounded-control border border-line-control bg-surface px-3 py-2 text-md shadow-xs hover:border-ink-muted"
          />
          <button
            type="submit"
            disabled={pending}
            className={`${primaryButtonClass} md:w-auto md:self-start`}
          >
            {pending ? 'Adding…' : 'Add addendum'}
          </button>
          {state.error ? <p className="text-sm text-danger">{state.error}</p> : null}
        </form>
      ) : null}
    </section>
  );
}
