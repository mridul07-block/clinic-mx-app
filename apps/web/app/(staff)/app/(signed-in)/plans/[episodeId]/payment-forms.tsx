'use client';

import { paymentMethodLabels, paymentMethods } from '@clinic-mx/schemas';
import { useActionState } from 'react';
import {
  FormMessage,
  primaryButtonClass,
  secondaryButtonClass,
  TextField,
} from '../../../../../../components/forms';
import {
  recordPaymentAction,
  undoPaymentAction,
  type PaymentFormState,
} from '../../../../../../modules/billing/actions';

const initialState: PaymentFormState = {};

/**
 * "Mark paid" on an unpaid bill (BIL-06): how the patient paid at the counter and an optional
 * reference; the whole total is recorded, never a typed amount. A refused post keeps what was
 * picked and typed.
 */
export function PaymentForm({
  episodeId,
  billId,
  total,
  totalPaise,
}: {
  episodeId: string;
  billId: string;
  total: string;
  /** The total shown, posted back: a total changed meanwhile is refused (BIL-07). */
  totalPaise: number;
}) {
  const [state, action, pending] = useActionState(recordPaymentAction, initialState);
  return (
    <form action={action} className="flex flex-col gap-2" data-testid="payment-form" noValidate>
      <input type="hidden" name="episodeId" value={episodeId} />
      <input type="hidden" name="billId" value={billId} />
      <input type="hidden" name="expectedTotal" value={totalPaise} />
      {state.error ? <FormMessage tone="danger">{state.error}</FormMessage> : null}
      <fieldset className="flex flex-wrap gap-x-5 gap-y-1">
        <legend className="mb-1 text-sm text-ink-secondary">Paid by</legend>
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
        helper="The UPI transaction ID or the card slip number."
      />
      <button
        type="submit"
        disabled={pending}
        className={`${primaryButtonClass} sm:w-auto sm:self-start`}
      >
        Mark paid {total}
      </button>
    </form>
  );
}

/** Undo a payment recorded by mistake, on the day it was recorded, with the reason. */
export function UndoPaymentForm({
  episodeId,
  paymentId,
}: {
  episodeId: string;
  paymentId: string;
}) {
  const [state, action, pending] = useActionState(undoPaymentAction, initialState);
  return (
    <details className="text-sm" open={Boolean(state.error)}>
      <summary className="min-h-11 cursor-pointer py-2.5 text-ink-secondary">Undo payment</summary>
      <form action={action} className="flex flex-col gap-2" noValidate>
        <input type="hidden" name="episodeId" value={episodeId} />
        <input type="hidden" name="paymentId" value={paymentId} />
        {state.error ? <FormMessage tone="danger">{state.error}</FormMessage> : null}
        <TextField
          label="Why is it undone?"
          name="reason"
          defaultValue={state.values?.reason}
          maxLength={300}
          helper="Only on the day it was recorded; after that Finance makes a refund."
        />
        <button
          type="submit"
          disabled={pending}
          className={`${secondaryButtonClass} sm:w-auto sm:self-start`}
        >
          Undo payment
        </button>
      </form>
    </details>
  );
}
