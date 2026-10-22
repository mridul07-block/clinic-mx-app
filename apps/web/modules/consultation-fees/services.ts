import 'server-only';
import { consultationFeeOptions, setConsultationFee, staffRecord } from '@clinic-mx/db';
import { consultationFeeSchema } from '@clinic-mx/schemas';
import { staffService, type ServiceContext } from '../access/service';
import { getSetting } from '../settings/settings';

/**
 * A consultant's consultation fee (decision G4; PRD section 7: the consultation fee is set by the
 * consulting physio's level), shown in their calendar column (SCH-05). The Super Admin picks one
 * of the price items in `billing.consultation_price_items`, or none.
 */

/** A refusal to show the Super Admin as it is. */
export class ConsultationFeeError extends Error {
  override name = 'ConsultationFeeError';
}

export async function setConsultationFeeService(context: ServiceContext, rawInput: unknown) {
  const keys = await getSetting('billing.consultation_price_items');
  return staffService({
    action: 'staff.manage',
    input: consultationFeeSchema,
    run: async (tx, { staffUserId, priceItemId }) => {
      const member = await staffRecord(tx, staffUserId);
      if (!member) throw new ConsultationFeeError('That staff member was not found.');
      if (priceItemId !== null) {
        if (!member.consultant) {
          throw new ConsultationFeeError('Only consultants have a consultation fee.');
        }
        const options = await consultationFeeOptions(tx, keys);
        if (!options.some((option) => option.id === priceItemId)) {
          throw new ConsultationFeeError('Choose one of the consultation fees listed.');
        }
      }
      await setConsultationFee(tx, staffUserId, priceItemId);
    },
  })(context, rawInput);
}
