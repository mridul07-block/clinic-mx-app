import 'server-only';
import {
  billCentre,
  refundablePayment,
  refundHistory,
  refundPayment,
  type RefundablePayment,
  type RefundEntry,
  type StaffMember,
} from '@clinic-mx/db';
import { can, refundLookupSchema, refundSchema } from '@clinic-mx/schemas';
import { NotAllowedError } from '../access/guard';
import { staffService } from '../access/service';
import { asStaff } from '../access/staff-db';

/**
 * Refunds (BIL-11; docs/runbooks/refunds.md). Recommended defaults chosen under the user's
 * standing approval, 28 October 2026: Finance or the Super Admin (`refunds.manage`) finds a
 * payment by its bill or invoice number and records money given back, with how and why; recording
 * it is the approval, with their name. The database refuses anyone else, more than was paid, an
 * undone payment and no reason, and closes the payment's live package once all of it is refunded.
 */

export class RefundError extends Error {
  override name = 'RefundError';
}

/** The database's refusals, as Finance reads them. */
const refusals: [RegExp, string][] = [
  [/never more than was paid/, 'That is more than is left to refund on this payment.'],
  [/undone payment/, 'This payment was undone, so there is nothing to refund.'],
  [/needs its reason/, 'Say why the money is refunded.'],
];

async function refusing<R>(work: () => Promise<R>): Promise<R> {
  try {
    return await work();
  } catch (error) {
    const cause = (error as { cause?: { message?: string } }).cause?.message ?? '';
    const refusal = refusals.find(([pattern]) => pattern.test(cause));
    if (refusal) throw new RefundError(refusal[1]);
    throw error;
  }
}

/** Records a refund against a payment; its id. */
export const refundBillPayment = staffService({
  action: 'refunds.manage',
  input: refundSchema,
  target: async (input, tx) => {
    const centreId = await billCentre(tx, { paymentId: input.paymentId });
    if (!centreId) throw new RefundError('That payment was not found.');
    return { centreId };
  },
  run: (tx, input) =>
    refusing(() =>
      refundPayment(tx, {
        paymentId: input.paymentId,
        amountPaise: input.amount,
        method: input.method,
        reference: input.reference,
        reason: input.reason,
      }),
    ),
});

/** What the Refunds tab shows: the payment looked up, if any, and the newest refunds. */
export interface RefundsView {
  found:
    | { status: 'none' }
    | { status: 'invalid'; error: string }
    | { status: 'missing'; number: string }
    | { status: 'found'; payment: RefundablePayment; leftPaise: number };
  history: RefundEntry[];
}

const HISTORY = 50;

/** The Refunds tab for Finance and the Super Admin, with `number` looked up when given. */
export async function refundsView(actor: StaffMember, number?: string): Promise<RefundsView> {
  if (!can(actor, 'refunds.manage')) throw new NotAllowedError();
  const typed = number?.trim();
  const parsed = typed ? refundLookupSchema.safeParse({ number: typed }) : undefined;
  return asStaff(actor, async (tx) => {
    const history = await refundHistory(tx, HISTORY);
    if (!typed || !parsed) return { found: { status: 'none' }, history };
    if (!parsed.success) {
      return {
        found: { status: 'invalid', error: parsed.error.issues[0]?.message ?? 'Check the number.' },
        history,
      };
    }
    const payment = await refundablePayment(tx, parsed.data.number);
    if (!payment) return { found: { status: 'missing', number: parsed.data.number }, history };
    return {
      found: { status: 'found', payment, leftPaise: payment.paidPaise - payment.refundedPaise },
      history,
    };
  });
}
