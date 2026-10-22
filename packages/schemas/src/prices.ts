import { z } from 'zod';
import { keyFromName } from './keys';
import { rupeesSchema } from './money';

/**
 * The price master (SET-02, TAD section 4 `price_item`, `package_type`): list prices, package
 * types and preset discounts. Finance and the Super Admin keep them (prices.manage); Centre
 * Managers and the front desk read them (prices.view). Decisions (user, 22 October 2026):
 * - a package type is a name, a number of sessions, a fixed package price and the price items it
 *   covers; validity and reschedules are the clinic-wide `packages.*` settings;
 * - a preset discount is a whole percent or a flat amount;
 * - nothing is deleted; items are deactivated, and the audit log is the price history.
 * DECISION #17: prices are the amount the patient pays; tax treatment on invoices is open.
 */

const name = (what: string) =>
  z
    .string()
    .trim()
    .min(1, { error: `Enter the ${what}’s name.` })
    .max(60, { error: 'Keep the name under 60 characters.' });

/** A list price: what it is called and what it costs. */
export const priceItemDetailsSchema = z.object({
  label: name('price item').regex(/[A-Za-z]/, { error: 'Use a name with letters in it.' }),
  amount: rupeesSchema,
});

export type PriceItemDetails = z.output<typeof priceItemDetailsSchema>;

/**
 * The stable key a price item is known by in settings and code (for example
 * `zero_gravity_treadmill` in `packages.never_reschedulable_items`), made from its name when it is
 * added and never changed after.
 */
export function priceItemKey(label: string): string {
  return keyFromName(label);
}

export const priceItemUpdateSchema = priceItemDetailsSchema.extend({ priceItemId: z.guid() });

export const priceItemActiveSchema = z.object({ priceItemId: z.guid(), active: z.boolean() });

/** A whole number typed in a form field, from `min` to `max`. */
const wholeNumber = (min: number, max: number, message: string) =>
  z
    .string()
    .trim()
    .regex(/^\d+$/, { error: message })
    .transform(Number)
    .pipe(z.number().int().min(min, { error: message }).max(max, { error: message }));

/**
 * A package type. What each package covers is open (decision 8); the client's list is entered here
 * when it is agreed.
 */
export const packageTypeDetailsSchema = z.object({
  name: name('package'),
  sessions: wholeNumber(1, 999, 'Enter the number of sessions, from 1 to 999.'),
  price: rupeesSchema,
  itemIds: z
    .array(z.guid())
    .min(1, { error: 'Choose what the package covers.' })
    .transform((ids) => [...new Set(ids)]),
});

export type PackageTypeDetails = z.output<typeof packageTypeDetailsSchema>;

export const packageTypeUpdateSchema = packageTypeDetailsSchema.extend({
  packageTypeId: z.guid(),
});

export const packageTypeActiveSchema = z.object({ packageTypeId: z.guid(), active: z.boolean() });

export const discountKinds = ['percent', 'flat'] as const;

export type DiscountKind = (typeof discountKinds)[number];

/**
 * A preset discount the front desk may apply (BIL-07). The client's list of types is decision 15;
 * Finance enters it here.
 */
export const discountPresetDetailsSchema = z.discriminatedUnion(
  'kind',
  [
    z.object({
      name: name('discount'),
      kind: z.literal('percent'),
      percent: wholeNumber(1, 100, 'Enter a whole percent from 1 to 100.'),
    }),
    z.object({ name: name('discount'), kind: z.literal('flat'), amount: rupeesSchema }),
  ],
  { error: 'Choose a percent or a flat amount.' },
);

export type DiscountPresetDetails = z.output<typeof discountPresetDetailsSchema>;

export const discountPresetUpdateSchema = z
  .object({ discountPresetId: z.guid() })
  .and(discountPresetDetailsSchema);

export const discountPresetActiveSchema = z.object({
  discountPresetId: z.guid(),
  active: z.boolean(),
});
