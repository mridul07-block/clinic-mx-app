'use client';

import { paymentMethodLabels, paymentMethods } from '@clinic-mx/schemas';
import { useActionState } from 'react';
import { FormMessage, primaryButtonClass, TextField } from '../../../../../../components/forms';
import { refundAction, type RefundFormState } from '../../../../../../modules/billing/actions';

const initialState: RefundFormState = {};

/**
 * Records a refund against a payment (BIL-11): the amount up to what is left, how it went back,
 * an optional reference and why. Works without scripts; a refused post keeps what was typed.
 */
export function RefundForm({ paymentId, left }: { paymentId: string; left: string }) {
  const [state, action, pending] = useActionState(refundAction, initialState);
  if (state.done) {
    return (
      <FormMessage tone="info">
        The refund is recorded. Find the payment again to see what is left.
      </FormMessage>
    );
  }
  return (
    <form action={action} className="flex flex-col gap-3" data-testid="refund-form" noValidate>
      <input type="hidden" name="paymentId" value={paymentId} />
      {state.error ? <FormMessage tone="danger">{state.error}</FormMessage> : null}
      <TextField
        label="Amount in rupees"
        name="amount"
        inputMode="decimal"
        defaultValue={state.values?.amount}
        helper={`Up to ${left}.`}
      />
      <fieldset className="flex flex-wrap gap-x-5 gap-y-1">
        <legend className="mb-1 text-sm text-ink-secondary">Refunded by</legend>
        {paymentMethods.map((method) => (
          <label key={method} className="flex min-h-11 items-center gap-2">
            <input
              type="radio"
              name="method"
              value={method}
              defaultChecked={state.values?.method === method}
              className="size-4 shrink-0 accent-accent"
            />
            {paymentMethodLabels[method]}
          </label>
        ))}
      </fieldset>
      <TextField
        label="Reference (optional)"
        name="reference"
        defaultValue={state.values?.reference}
        maxLength={40}
        helper="The UPI transaction ID, the card reversal number or a note."
      />
      <TextField
        label="Why is it refunded?"
        name="reason"
        defaultValue={state.values?.reason}
        maxLength={300}
        helper="Recorded with your name as the approval."
      />
      <button
        type="submit"
        disabled={pending}
        className={`${primaryButtonClass} sm:w-auto sm:self-start`}
      >
        Record refund
      </button>
    </form>
  );
}
