'use client';

import { dataRequestKindLabels, dataRequestKinds } from '@clinic-mx/schemas';
import { useActionState, useId } from 'react';
import {
  FormMessage,
  TextAreaField,
  TextField,
  dangerButtonClass,
  primaryButtonClass,
  secondaryButtonClass,
} from '../../../../../components/forms';
import {
  closeDataRequestAction,
  recordDataRequestAction,
  type DataRequestFormState,
} from '../../../../../modules/data-requests/actions';

const initialState: DataRequestFormState = {};

/** A new request for the patient (ADM-03): what they ask for, when it came, in their words. */
export function RecordDataRequestForm({ patientId, today }: { patientId: string; today: string }) {
  const [state, action, pending] = useActionState(recordDataRequestAction, initialState);
  const kindId = useId();
  const kindError = state.fieldErrors?.kind;
  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="patientId" value={patientId} />
      {state.error ? <FormMessage tone="danger">{state.error}</FormMessage> : null}
      <div className="flex flex-col gap-1.5">
        <label htmlFor={kindId} className="font-medium text-ink">
          They ask for
        </label>
        <select
          id={kindId}
          name="kind"
          defaultValue={state.values?.kind ?? ''}
          aria-invalid={kindError ? true : undefined}
          className="h-row w-full rounded-control border border-line-control bg-surface px-3 text-ink shadow-xs pointer-coarse:h-row-touch"
        >
          <option value="" disabled>
            Choose
          </option>
          {dataRequestKinds.map((kind) => (
            <option key={kind} value={kind}>
              {dataRequestKindLabels[kind]}
            </option>
          ))}
        </select>
        {kindError ? <p className="text-sm text-danger">{kindError}</p> : null}
      </div>
      <TextField
        label="Received on"
        name="receivedOn"
        type="date"
        max={today}
        defaultValue={state.values?.receivedOn ?? today}
        error={state.fieldErrors?.receivedOn}
      />
      <TextAreaField
        label="What they asked for"
        name="details"
        rows={4}
        maxLength={2000}
        defaultValue={state.values?.details}
        error={state.fieldErrors?.details}
        helper="In your words: what, how they asked, how to reply. No clinical details."
      />
      <button type="submit" disabled={pending} className={`${primaryButtonClass} sm:w-auto`}>
        Record request
      </button>
    </form>
  );
}

/** Closing an open request, done or declined, with what was done. */
export function CloseDataRequestForm({ requestId }: { requestId: string }) {
  const [state, action, pending] = useActionState(closeDataRequestAction, initialState);
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="requestId" value={requestId} />
      {state.error ? <FormMessage tone="danger">{state.error}</FormMessage> : null}
      <TextAreaField
        label="What was done"
        name="outcome"
        rows={3}
        maxLength={2000}
        defaultValue={state.values?.outcome}
        error={state.fieldErrors?.outcome}
        helper="For example, how the copy was sent, or why the request was declined."
      />
      <div className="flex flex-col gap-2 sm:flex-row">
        <button
          type="submit"
          name="status"
          value="done"
          disabled={pending}
          className={`${secondaryButtonClass} sm:w-auto`}
        >
          Close as done
        </button>
        <button
          type="submit"
          name="status"
          value="declined"
          disabled={pending}
          className={`${dangerButtonClass} sm:w-auto`}
        >
          Close as declined
        </button>
      </div>
    </form>
  );
}
