import 'server-only';
import { consultationBillNow, consultationFeeState, episodeRecord } from '@clinic-mx/db';
import { consultationFeeDue, makeConsultationBillSchema } from '@clinic-mx/schemas';
import { staffService } from '../access/service';
import { getSetting } from '../settings/settings';

/**
 * Bills at fixed prices (BIL-05, PRD J4.6; user decisions, 25 October 2026). The database makes
 * the consultation fee bill when `billing.consultation_fee_timing` says, at the consultant's own
 * fee, and a package bill when one is chosen; nobody types a price. When the consultant had no fee
 * set, the desk makes the bill from the sheet once the Super Admin sets one, by the same rules
 * (`internal.consultation_bill_now`).
 */

export class BillError extends Error {
  override name = 'BillError';
}

export const makeConsultationBill = staffService({
  action: 'bills.create_and_collect',
  input: makeConsultationBillSchema,
  target: async (input, tx) => {
    const episode = await episodeRecord(tx, input.episodeId);
    if (!episode) throw new BillError('That episode was not found.');
    return { centreId: episode.centreId };
  },
  run: async (tx, { episodeId }) => {
    const visit = await consultationFeeState(tx, episodeId);
    if (!visit) throw new BillError('This episode has no consultation to bill.');
    if (visit.billed) throw new BillError('The consultation is already billed.');
    if (!visit.feeLabel) {
      throw new BillError(
        `Consultation fee not set for ${visit.consultantName}. Ask the Super Admin to set it on Staff.`,
      );
    }
    if (!consultationFeeDue(await getSetting('billing.consultation_fee_timing'), visit.status)) {
      throw new BillError('The consultation fee is not due yet.');
    }
    const made = await consultationBillNow(tx, visit.appointmentId);
    if (!made) throw new BillError('The consultation could not be billed.');
    return made;
  },
});
