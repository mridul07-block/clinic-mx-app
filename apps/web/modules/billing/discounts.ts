import 'server-only';
import { applyDiscount, billCentre, removeDiscount } from '@clinic-mx/db';
import { applyDiscountSchema, removeDiscountSchema, type ApplyDiscount } from '@clinic-mx/schemas';
import type { ServiceContext } from '../access/service';
import { staffService } from '../access/service';

/**
 * Discounts (BIL-07, decision 15; recommended defaults chosen under the user's standing approval,
 * 28 October 2026): on an unpaid bill the front desk applies a preset from the clinic's list;
 * any other discount, a whole percent or an amount with its reason, is Finance's or the Super
 * Admin's, and applying it is the approval. The database copies the preset, refuses a discount
 * down to ₹0, a paid bill and anyone else, and makes the bill's total the lines less their
 * discounts; audited as the person.
 */

export class DiscountError extends Error {
  override name = 'DiscountError';
}

/** The database's refusals, as the desk reads them. */
const refusals: [RegExp, string][] = [
  [
    /Only an unpaid bill is discounted/,
    'This bill is no longer unpaid, so its discount cannot change. Reload the page.',
  ],
  [/would make the bill free/, 'A discount cannot take the bill to ₹0.'],
  [/not in use/, 'That discount is no longer in use. Choose another.'],
  [/Other discounts are applied by Finance/, 'Only Finance changes this discount.'],
];

async function refusing<R>(work: () => Promise<R>): Promise<R> {
  try {
    return await work();
  } catch (error) {
    const cause = (error as { cause?: { message?: string } }).cause?.message ?? '';
    const refusal = refusals.find(([pattern]) => pattern.test(cause));
    if (refusal) throw new DiscountError(refusal[1]);
    throw error;
  }
}

const lineCentre = async (input: { lineId: string }, tx: Parameters<typeof billCentre>[0]) => {
  const centreId = await billCentre(tx, { lineId: input.lineId });
  if (!centreId) throw new DiscountError('That bill was not found.');
  return { centreId };
};

const applyPreset = staffService({
  action: 'discounts.apply_preset',
  input: applyDiscountSchema,
  target: lineCentre,
  run: (tx, input) =>
    refusing(() =>
      applyDiscount(tx, {
        lineId: input.lineId,
        presetId: input.kind === 'preset' ? input.presetId : null,
      }),
    ),
});

const applyOther = staffService({
  action: 'discounts.apply_any',
  input: applyDiscountSchema,
  target: lineCentre,
  run: (tx, input) =>
    refusing(() =>
      applyDiscount(tx, {
        lineId: input.lineId,
        presetId: input.kind === 'preset' ? input.presetId : null,
        percent: input.kind === 'percent' ? input.percent : null,
        amountPaise: input.kind === 'flat' ? input.amount : null,
        reason: input.kind === 'preset' ? null : input.reason,
      }),
    ),
});

/**
 * Applies a discount to a bill's line: a preset needs `discounts.apply_preset`, an Other
 * discount `discounts.apply_any`. The bill's new total.
 */
export function applyBillDiscount(context: ServiceContext, input: unknown): Promise<number> {
  const kind = (input as Partial<ApplyDiscount> | null)?.kind;
  return kind === 'preset' ? applyPreset(context, input) : applyOther(context, input);
}

/** Takes a line's discount off; the database keeps an Other discount for Finance. */
export const removeBillDiscount = staffService({
  action: 'discounts.apply_preset',
  input: removeDiscountSchema,
  target: lineCentre,
  run: (tx, input) => refusing(() => removeDiscount(tx, input.lineId)),
});
