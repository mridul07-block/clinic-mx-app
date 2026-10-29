'use client';

import {
  PATIENT_CONTENT_MAX,
  patientContentPartHints,
  patientContentPartLabels,
  patientContentParts,
  type PatientContentPart,
} from '@clinic-mx/schemas';
import { useActionState } from 'react';
import {
  FormMessage,
  TextAreaField,
  dangerButtonClass,
  primaryButtonClass,
  secondaryButtonClass,
} from '../../../../../../../components/forms';
import {
  approvePatientContentAction,
  discardPatientContentAction,
  savePatientContentAction,
  type PatientContentDecisionState,
  type PatientContentFormState,
} from '../../../../../../../modules/knowledge-base/patient-content-actions';

/**
 * The condition's draft (AI-07): its four parts, each saved together. Writing a new draft over
 * approved content starts from the approved text.
 */
export function DraftForm({
  conditionId,
  draft,
  open,
}: {
  conditionId: string;
  /** The draft to change, or the approved text to start a new one from. */
  draft?: Record<PatientContentPart, string>;
  /** The draft open and its revision; none when saving writes a new one. */
  open?: { id: string; revision: number };
}) {
  const [state, action, pending] = useActionState<PatientContentFormState, FormData>(
    savePatientContentAction,
    {},
  );
  return (
    <form
      action={action}
      className="flex flex-col gap-4"
      noValidate
      data-testid="patient-content-form"
    >
      <input type="hidden" name="conditionId" value={conditionId} />
      {open ? (
        <>
          <input type="hidden" name="draftId" value={open.id} />
          <input type="hidden" name="revision" value={open.revision} />
        </>
      ) : null}
      {state.error && !state.errors ? <FormMessage tone="danger">{state.error}</FormMessage> : null}
      {state.saved ? <FormMessage tone="info">Draft saved.</FormMessage> : null}
      {patientContentParts.map((part) => (
        <TextAreaField
          key={part}
          label={patientContentPartLabels[part]}
          name={part}
          rows={5}
          maxLength={PATIENT_CONTENT_MAX}
          defaultValue={state.values?.[part] ?? draft?.[part] ?? ''}
          helper={patientContentPartHints[part]}
          error={state.errors?.[part]}
        />
      ))}
      <button type="submit" className={primaryButtonClass} disabled={pending}>
        {open ? 'Save draft' : 'Save as draft'}
      </button>
    </form>
  );
}

/** Approve the draft as read (patients see it from then on), or discard it. */
export function DecideDraft({
  conditionId,
  draftId,
  revision,
}: {
  conditionId: string;
  draftId: string;
  revision: number;
}) {
  const [approved, approve, approving] = useActionState<PatientContentDecisionState, FormData>(
    approvePatientContentAction,
    {},
  );
  const [discarded, discard, discarding] = useActionState<PatientContentDecisionState, FormData>(
    discardPatientContentAction,
    {},
  );
  const error = approved.error ?? discarded.error;
  return (
    <div className="flex flex-col gap-3" data-testid="patient-content-decide">
      {error ? <FormMessage tone="danger">{error}</FormMessage> : null}
      <p className="text-sm text-ink-secondary">
        Save your changes first. Approving shows the saved draft to patients, in place of any
        approved content.
      </p>
      <div className="flex flex-col gap-2 sm:flex-row">
        <form action={approve}>
          <input type="hidden" name="conditionId" value={conditionId} />
          <input type="hidden" name="draftId" value={draftId} />
          <input type="hidden" name="revision" value={revision} />
          <button type="submit" className={`${secondaryButtonClass} w-full`} disabled={approving}>
            Approve for patients
          </button>
        </form>
        <form action={discard}>
          <input type="hidden" name="conditionId" value={conditionId} />
          <input type="hidden" name="draftId" value={draftId} />
          <input type="hidden" name="revision" value={revision} />
          <button type="submit" className={`${dangerButtonClass} w-full`} disabled={discarding}>
            Discard draft
          </button>
        </form>
      </div>
    </div>
  );
}
