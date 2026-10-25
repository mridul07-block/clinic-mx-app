'use client';

import { useActionState } from 'react';
import {
  FormMessage,
  primaryButtonClass,
  secondaryButtonClass,
  TextAreaField,
  TextField,
} from '../../../../../components/forms';
import {
  closeAlertAction,
  referAlertAction,
  reviewAlertAction,
  type AlertFormState,
} from '../../../../../modules/alerts/actions';

const initialState: AlertFormState = {};

function Refusal({ state }: { state: AlertFormState }) {
  return state.error ? <FormMessage tone="danger">{state.error}</FormMessage> : null;
}

/** "I'm reviewing" on a Raised alert (ALT-01). */
export function ReviewForm({ alertId }: { alertId: string }) {
  const [state, action, pending] = useActionState(reviewAlertAction, initialState);
  return (
    <form action={action} className="flex flex-col gap-2">
      <input type="hidden" name="alertId" value={alertId} />
      <Refusal state={state} />
      <button type="submit" disabled={pending} className={`${primaryButtonClass} sm:w-auto`}>
        I’m reviewing
      </button>
    </form>
  );
}

/**
 * Refer: where the patient was sent, and for the referral letter (ALT-07) the reason and the
 * question for the specialist; the episode goes On hold.
 */
export function ReferForm({ alertId }: { alertId: string }) {
  const [state, action, pending] = useActionState(referAlertAction, initialState);
  return (
    <form action={action} className="flex flex-col gap-2" noValidate>
      <input type="hidden" name="alertId" value={alertId} />
      <Refusal state={state} />
      <TextField
        label="Referred to"
        name="referredTo"
        defaultValue={state.values?.referredTo}
        maxLength={200}
        helper="For example the emergency department or a doctor. The episode goes On hold."
      />
      <TextAreaField
        label="Reason"
        name="reason"
        defaultValue={state.values?.reason}
        maxLength={1000}
        rows={3}
        helper="The red flags found and your reasoning, for the referral letter."
      />
      <TextAreaField
        label="Question for the specialist"
        name="question"
        defaultValue={state.values?.question}
        maxLength={1000}
        rows={2}
        helper="A referral letter is generated and added to the patient's Documents."
      />
      <button type="submit" disabled={pending} className={`${secondaryButtonClass} sm:w-auto`}>
        Refer
      </button>
    </form>
  );
}

/** Close with the clinician's written decision. */
export function CloseForm({ alertId }: { alertId: string }) {
  const [state, action, pending] = useActionState(closeAlertAction, initialState);
  return (
    <form action={action} className="flex flex-col gap-2" noValidate>
      <input type="hidden" name="alertId" value={alertId} />
      <Refusal state={state} />
      <TextAreaField label="Decision" name="decision" maxLength={1000} />
      <button type="submit" disabled={pending} className={`${secondaryButtonClass} sm:w-auto`}>
        Close with decision
      </button>
    </form>
  );
}
