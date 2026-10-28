import { z } from 'zod';
import { paymentMethods } from './bills';
import { rupeesSchema } from './money';

/**
 * Refunds (BIL-11, TAD `refund_credit`; decisions 9 and 12). Recommended defaults chosen under the
 * user's standing approval, 28 October 2026 (docs/runbooks/refunds.md): Finance or the Super Admin
 * records money given back against a payment, any day, with the amount (never more than was paid,
 * several allowed), how it went back, an optional reference and the reason; recording it is the
 * approval. No time limit or eligibility rule until the client words the refund policy (decision
 * 9); credits for unused sessions wait for decision 12.
 */

/** Finding a payment to refund by its bill or invoice number, as printed. */
export const refundLookupSchema = z.object({
  number: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{2,4}-(B|INV)-\d{5,}$/, {
      error: 'Enter a bill or invoice number, for example HSR-B-00042.',
    }),
});

export const refundSchema = z.object({
  paymentId: z.guid({ error: 'That payment was not found.' }),
  amount: rupeesSchema,
  method: z.enum(paymentMethods, { error: 'Choose how the money went back.' }),
  reference: z
    .string()
    .trim()
    .max(40, { error: 'Keep the reference to 40 characters.' })
    .transform((value) => value || undefined)
    .optional(),
  reason: z
    .string()
    .trim()
    .min(1, { error: 'Say why the money is refunded.' })
    .max(300, { error: 'Keep the reason to 300 characters.' }),
});

export type RefundInput = z.output<typeof refundSchema>;
