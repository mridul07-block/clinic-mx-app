import { z } from 'zod';

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
