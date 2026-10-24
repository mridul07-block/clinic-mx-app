import { z } from 'zod';

/**
 * Money (rule 15): amounts are stored as integer paise and shown in rupees with Indian grouping
 * (₹18,40,000; Frontend Specification section 2). First used by the price master (SET-02), then
 * by bills.
 */

/** The largest amount a Postgres `integer` column holds, in paise (about ₹2.1 crore). */
export const MAX_PAISE = 2_147_483_647;

const amountMessage = 'Enter an amount in rupees, for example 1,500.';

/**
 * An amount in rupees as people type it (`1500`, `1,500`, `₹1,500.50`), as integer paise.
 * Zero and negative amounts are refused; a free item is not a price.
 */
export const rupeesSchema = z
  .string()
  .trim()
  .transform((typed) => typed.replace(/^₹\s*/, '').replace(/,/g, ''))
  .pipe(z.string().regex(/^\d+$|^\d+\.\d{1,2}$/, { error: amountMessage }))
  .transform((rupees) => {
    const [whole = '0', fraction = ''] = rupees.split('.');
    return Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  })
  .pipe(
    z
      .number()
      .int()
      .min(1, { error: 'Enter an amount above ₹0.' })
      .max(MAX_PAISE, { error: 'That amount is too large.' }),
  );

const grouping = new Intl.NumberFormat('en-IN');

/** An amount in paise as rupees without the symbol, for form fields: 1,500 or 1,500.50. */
export function rupeesText(paise: number): string {
  const sign = paise < 0 ? '-' : '';
  const absolute = Math.abs(paise);
  const whole = grouping.format(Math.floor(absolute / 100));
  const fraction = absolute % 100;
  return fraction === 0
    ? `${sign}${whole}`
    : `${sign}${whole}.${String(fraction).padStart(2, '0')}`;
}

/** A whole number with Indian grouping, for counts on documents: 1,00,000. */
export function indianNumber(value: number): string {
  return grouping.format(value);
}

/** An amount in paise as people read it: ₹1,500, ₹1,500.50 or ₹18,40,000. */
export function formatRupees(paise: number): string {
  const text = rupeesText(paise);
  return text.startsWith('-') ? `-₹${text.slice(1)}` : `₹${text}`;
}
