import type { DiscountPresetEntry } from '@clinic-mx/db';
import { formatRupees } from '@clinic-mx/schemas';

/** A preset discount as people read it: 10% off, or ₹500 off. */
export function discountText(discount: DiscountPresetEntry): string {
  return discount.kind === 'percent'
    ? `${String(discount.percent)}% off`
    : `${formatRupees(discount.amountPaise)} off`;
}

/** Notices after a change, by the `done` search parameter. */
export const notices = (noun: string): Record<string, string> => ({
  added: `${noun} added.`,
  saved: `${noun} saved.`,
  deactivated: `${noun} deactivated. Bills already made and its history are kept.`,
  reactivated: `${noun} reactivated.`,
});
