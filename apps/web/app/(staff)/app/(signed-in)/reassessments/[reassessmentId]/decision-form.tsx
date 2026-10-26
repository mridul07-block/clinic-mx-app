'use client';

import { REASSESSMENT_DECISION_MAX } from '@clinic-mx/schemas';
import { useActionState } from 'react';
import { primaryButtonClass } from '../../../../../../components/forms';
import {
  signReassessmentAction,
  type ReassessmentDecisionState,
} from '../../../../../../modules/reassessments/actions';

const initialState: ReassessmentDecisionState = {};

/** The consultant writes the decision in their own words and signs it once (OUT-05). */
export function DecisionForm({ reassessmentId }: { reassessmentId: string }) {
  const [state, action, pending] = useActionState(signReassessmentAction, initialState);
  return (
    <form action={action} className="flex flex-col gap-3" data-testid="reassessment-decision-form">
      <input type="hidden" name="reassessmentId" value={reassessmentId} />
      <label className="flex flex-col gap-1.5">
        <span className="font-medium text-ink">Decision</span>
        <span className="text-sm text-ink-secondary">
          What happens next with the plan, in your own words. Once signed, it never changes.
        </span>
        <textarea
          name="decision"
          rows={4}
          required
          maxLength={REASSESSMENT_DECISION_MAX}
          className="w-full min-w-0 rounded-control border border-line-control bg-surface px-3 py-2 text-md shadow-xs hover:border-ink-muted"
        />
      </label>
      <button
        type="submit"
        disabled={pending}
        className={`${primaryButtonClass} md:w-auto md:self-start`}
      >
        {pending ? 'Signing…' : 'Sign decision'}
      </button>
      {state.error ? (
        <p role="alert" className="text-sm text-danger">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
