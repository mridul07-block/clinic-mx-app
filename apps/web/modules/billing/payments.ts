import 'server-only';
import { billCentre, recordPayment, undoPayment } from '@clinic-mx/db';
import { recordPaymentSchema, undoPaymentSchema } from '@clinic-mx/schemas';
import { staffService } from '../access/service';

/**
 * Counter payments (BIL-06, PRD J4.6; user decisions, 25 October 2026): the desk marks a bill
 * paid by UPI QR, card or cash with an optional reference, for its whole total; the database
 * records it as the person signed in and activates the episode once the chosen plan is paid
 * (J4.7). A payment recorded by mistake is undone on its day with a reason; later, Finance makes
 * a refund.
 */

export class PaymentError extends Error {
  override name = 'PaymentError';
}

/** The database's refusals, as the desk reads them. */
const refusals: [RegExp, string][] = [
  [/Only an unpaid bill is paid/, 'This bill is already paid.'],
  [
    /total has changed/,
    'The bill’s total has changed. Reload the page, check the new total with the patient, then mark paid.',
  ],
  [/already undone/, 'This payment is already undone.'],
  [/has a refund/, 'Finance has refunded this payment, so it cannot be undone.'],
  [
    /Sessions from this package have been used/,
    'A session from this package has been used, so the payment cannot be undone; Finance makes a refund.',
  ],
  [
    /only on the day it was recorded/,
    'A payment is undone on the day it was recorded; after that Finance makes a refund.',
  ],
];

async function refusing<R>(work: () => Promise<R>): Promise<R> {
  try {
    return await work();
  } catch (error) {
    const cause = (error as { cause?: { message?: string } }).cause?.message ?? '';
    const refusal = refusals.find(([pattern]) => pattern.test(cause));
    if (refusal) throw new PaymentError(refusal[1]);
    throw error;
  }
}

export const recordBillPayment = staffService({
  action: 'bills.create_and_collect',
  input: recordPaymentSchema,
  target: async (input, tx) => {
    const centreId = await billCentre(tx, { billId: input.billId });
    if (!centreId) throw new PaymentError('That bill was not found.');
    return { centreId };
  },
  run: (tx, input) => refusing(() => recordPayment(tx, input)),
});

export const undoBillPayment = staffService({
  action: 'bills.create_and_collect',
  input: undoPaymentSchema,
  target: async (input, tx) => {
    const centreId = await billCentre(tx, { paymentId: input.paymentId });
    if (!centreId) throw new PaymentError('That payment was not found.');
    return { centreId };
  },
  run: (tx, input) => refusing(() => undoPayment(tx, input)),
});
