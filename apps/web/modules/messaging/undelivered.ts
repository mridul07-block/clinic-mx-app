import 'server-only';
import {
  followUpUndelivered,
  undeliveredMessages,
  type StaffMember,
  type UndeliveredMessage,
} from '@clinic-mx/db';
import { can, followUpUndeliveredSchema } from '@clinic-mx/schemas';
import { staffService } from '../access/service';
import { asStaff } from '../access/staff-db';

/**
 * "Not delivered" on Today (WA-13; docs/runbooks/whatsapp.md, "Not delivered"): the centre's
 * WhatsApp messages Meta could not deliver to a known patient, for those who run Today there,
 * until someone marks one Done once they have called. The database decides what each person sees
 * (`internal.undelivered_messages`), never a Velyx support login; this checks the permission too.
 */

export async function undeliveredFor(
  staff: StaffMember,
  centreId: string,
): Promise<UndeliveredMessage[]> {
  if (!can(staff, 'check_in.manage', { centreId }) || staff.support) return [];
  return asStaff(staff, (tx) => undeliveredMessages(tx, centreId));
}

/** Done on one, as the signed in person; audited. False when it was done already or not theirs. */
export const markUndeliveredDone = staffService({
  action: 'check_in.manage',
  input: followUpUndeliveredSchema,
  target: (input) => Promise.resolve({ centreId: input.centreId }),
  run: (tx, input) => followUpUndelivered(tx, input.messageId),
});
