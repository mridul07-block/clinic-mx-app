import { z } from 'zod';
import { istDate } from './ist';

/**
 * Bills at fixed prices (BIL-05, PRD J4.6, TAD section 9). The database makes them, at the price
 * master's amounts, so nobody edits a price at the desk: the consultation fee when
 * `billing.consultation_fee_timing` says (after the consultation or at check in), at the
 * consultant's own fee (decision G4), and a package bill when the patient chooses a package
 * (BIL-02). Numbers are the centre's code, "B" and its next bill number, for example HSR-B-00001.
 * Payment (BIL-06), discounts (BIL-07) and invoices (BIL-09) come with their tickets.
 */

export const billKinds = ['consultation', 'package'] as const;
export type BillKind = (typeof billKinds)[number];

export const billKindLabels: Record<BillKind, string> = {
  consultation: 'Consultation fee',
  package: 'Package',
};

export const billStatuses = ['unpaid', 'paid', 'cancelled'] as const;
export type BillStatus = (typeof billStatuses)[number];

export const billStatusLabels: Record<BillStatus, string> = {
  unpaid: 'Unpaid',
  paid: 'Paid',
  cancelled: 'Cancelled',
};

/** A bill number: the centre's code, "B" and five digits or more. */
export const billNumberPattern = /^[A-Z]{2,4}-B-\d{5,}$/;

/** "Make the consultation bill" on the plan and payment sheet, once the fee is set. */
export const makeConsultationBillSchema = z.object({
  episodeId: z.guid({ error: 'That episode was not found.' }),
});

/** Whether a consultation visit in this status is due its fee bill under the timing setting. */
export function consultationFeeDue(
  timing: 'after_consultation' | 'at_check_in',
  status: string,
): boolean {
  return timing === 'after_consultation'
    ? status === 'completed'
    : ['checked_in', 'in_progress', 'completed'].includes(status);
}

/** How the patient paid at the counter (PRD J4.6): the clinic's UPI QR, the card machine or cash. */
export const paymentMethods = ['upi', 'card', 'cash'] as const;
export type PaymentMethod = (typeof paymentMethods)[number];

export const paymentMethodLabels: Record<PaymentMethod, string> = {
  upi: 'UPI QR',
  card: 'Card',
  cash: 'Cash',
};

/**
 * "Mark paid" on a bill (BIL-06): the whole total, by a method, with an optional reference (the
 * UPI transaction ID or the card slip number). Nobody types an amount; partial payments wait for
 * the client (decision 10).
 */
export const recordPaymentSchema = z.object({
  billId: z.guid({ error: 'That bill was not found.' }),
  method: z.enum(paymentMethods, { error: 'Choose how the patient paid.' }),
  reference: z
    .string()
    .trim()
    .max(40, { error: 'Keep the reference to 40 characters.' })
    .transform((value) => value || undefined)
    .optional(),
});

/** Undoing a payment recorded by mistake, on the day it was recorded, with the reason. */
export const undoPaymentSchema = z.object({
  paymentId: z.guid({ error: 'That payment was not found.' }),
  reason: z
    .string()
    .trim()
    .min(1, { error: 'Say why the payment is undone.' })
    .max(300, { error: 'Keep the reason to 300 characters.' }),
});

/**
 * The IST date a package bought at `paidAt` stays valid until (BIL-09, decision: from the payment
 * date, `packages.validity_months` later): the same day that many months on, or the month's last
 * day when it has no such day (30 Nov plus 3 months is 28 Feb). BIL-08 uses the same rule.
 */
export function packageValidUntil(paidAt: Date, months: number): string {
  const [year = 0, month = 1, day = 1] = istDate(paidAt).split('-').map(Number);
  const target = new Date(Date.UTC(year, month - 1 + months, 1));
  const lastDay = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return target.toISOString().slice(0, 10);
}
