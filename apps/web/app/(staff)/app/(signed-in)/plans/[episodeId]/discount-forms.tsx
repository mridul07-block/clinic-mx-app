'use client';

import { useActionState } from 'react';
import { FormMessage, secondaryButtonClass, TextField } from '../../../../../../components/forms';
import {
  applyDiscountAction,
  removeDiscountAction,
  type DiscountFormState,
} from '../../../../../../modules/billing/actions';

const initialState: DiscountFormState = {};

const radio = 'size-4 shrink-0 accent-accent';

/**
 * A discount on an unpaid bill's line (BIL-07, decision 15): a preset from the clinic's list, or
 * for Finance and the Super Admin an Other discount, a whole percent or an amount, with the reason
 * that records their approval. Works without scripts; a refused post keeps what was picked.
 */
export function DiscountForm({
  episodeId,
  lineId,
  presets,
  other,
  replacing,
}: {
  episodeId: string;
  lineId: string;
  presets: { id: string; name: string; value: string }[];
  /** Finance or the Super Admin: an Other discount too. */
  other: boolean;
  /** The line has a discount already: this one replaces it. */
  replacing: boolean;
}) {
  const [state, action, pending] = useActionState(applyDiscountAction, initialState);
  const picked = state.values?.choice;
  if (presets.length === 0 && !other) {
    return (
      <p className="text-sm text-ink-muted" data-testid="no-discounts">
        No discounts are set up yet. Finance adds the clinic&apos;s list on Prices.
      </p>
    );
  }
  return (
    <details className="text-sm" open={Boolean(state.error)} data-testid="discount-form">
      <summary className="min-h-11 cursor-pointer py-2.5 text-ink-secondary">
        {replacing ? 'Change the discount' : 'Apply a discount'}
      </summary>
      <form action={action} className="flex flex-col gap-3" noValidate>
        <input type="hidden" name="episodeId" value={episodeId} />
        <input type="hidden" name="lineId" value={lineId} />
        {state.error ? <FormMessage tone="danger">{state.error}</FormMessage> : null}
        <fieldset className="flex flex-col gap-1">
          <legend className="mb-1 text-ink-secondary">Discount</legend>
          {presets.map((preset) => (
            <label key={preset.id} className="flex min-h-11 items-center gap-2">
              <input
                type="radio"
                name="choice"
                value={`preset:${preset.id}`}
                defaultChecked={picked === `preset:${preset.id}`}
                className={radio}
              />
              <span>
                {preset.name}{' '}
                <span className="tabular-nums text-ink-secondary">{preset.value}</span>
              </span>
            </label>
          ))}
          {other ? (
            <label className="flex min-h-11 items-center gap-2">
              <input
                type="radio"
                name="choice"
                value="other"
                defaultChecked={picked === 'other'}
                className={radio}
              />
              Other discount
            </label>
          ) : null}
        </fieldset>
        {other ? (
          <fieldset className="flex flex-col gap-3 border-l-2 border-line pl-3">
            <legend className="mb-1 text-ink-secondary">Other discount</legend>
            <div className="flex flex-wrap gap-x-5">
              {(['percent', 'amount'] as const).map((by) => (
                <label key={by} className="flex min-h-11 items-center gap-2">
                  <input
                    type="radio"
                    name="by"
                    value={by}
                    defaultChecked={(state.values?.by ?? 'percent') === by}
                    className={radio}
                  />
                  {by === 'percent' ? 'A percent' : 'An amount'}
                </label>
              ))}
            </div>
            <TextField
              label="Percent"
              name="percent"
              inputMode="numeric"
              defaultValue={state.values?.percent}
              helper="A whole percent from 1 to 99."
            />
            <TextField
              label="Amount in rupees"
              name="amount"
              inputMode="decimal"
              defaultValue={state.values?.amount}
            />
            <TextField
              label="Reason"
              name="reason"
              defaultValue={state.values?.reason}
              maxLength={300}
              helper="Recorded with your name as the approval."
            />
          </fieldset>
        ) : null}
        <button
          type="submit"
          disabled={pending}
          className={`${secondaryButtonClass} sm:w-auto sm:self-start`}
        >
          Apply discount
        </button>
      </form>
    </details>
  );
}

/** Takes a line's discount off an unpaid bill. */
export function RemoveDiscountForm({ episodeId, lineId }: { episodeId: string; lineId: string }) {
  const [state, action, pending] = useActionState(removeDiscountAction, initialState);
  return (
    <form action={action} className="flex flex-col gap-2 text-sm" noValidate>
      <input type="hidden" name="episodeId" value={episodeId} />
      <input type="hidden" name="lineId" value={lineId} />
      {state.error ? <FormMessage tone="danger">{state.error}</FormMessage> : null}
      <button
        type="submit"
        disabled={pending}
        className="min-h-11 self-start py-2.5 text-ink-secondary underline underline-offset-2"
      >
        Remove the discount
      </button>
    </form>
  );
}
