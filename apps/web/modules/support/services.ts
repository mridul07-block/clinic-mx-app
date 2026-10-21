import 'server-only';
import {
  activeGrant,
  endSupportGrant,
  endSupportSessions,
  insertStaffMember,
  insertSupportGrant,
  linkStaffLogin,
  recordAccessEvent,
  staffEmailTaken,
} from '@clinic-mx/db';
import {
  endSupportSchema,
  formatIstDateTime,
  grantSupportSchema,
  supportLoginSchema,
} from '@clinic-mx/schemas';
import { staffService, type ServiceContext } from '../access/service';
import { getSetting } from '../settings/settings';
import { sendInvite, type InviteResult } from '../staff/services';

/**
 * Velyx support access (IAM-08, PRD section 2): off by default; the Super Admin grants it for up
 * to the setting's hours with a reason, ends it early, and adds the support logins that may sign
 * in while it is on. Each is a staffService for support_access.grant: under row level security
 * and audited. A support login itself is read only, so it can do none of this.
 */

/** A refusal to show the Super Admin as it is. */
export class SupportActionError extends Error {
  override name = 'SupportActionError';
}

/** Grants support access from now. One grant is active at a time. */
export async function grantSupportAccess(context: ServiceContext, rawInput: unknown) {
  const maxHours = await getSetting('security.support_grant_max_hours');
  return staffService({
    action: 'support_access.grant',
    input: grantSupportSchema(maxHours),
    run: async (tx, { hours, reason }, actor) => {
      const active = await activeGrant(tx);
      if (active) {
        throw new SupportActionError(
          `Support access is already on until ${formatIstDateTime(active.endsAt)}. End it before granting it again.`,
        );
      }
      return insertSupportGrant(tx, { grantedBy: actor.id, hours, reason });
    },
  })(context, rawInput);
}

/** Ends support access now and every support login's sessions with it. */
export const endSupportAccess = staffService({
  action: 'support_access.grant',
  input: endSupportSchema,
  run: async (tx, { grantId }): Promise<{ sessionsEnded: number }> => {
    if (!(await endSupportGrant(tx, grantId))) {
      throw new SupportActionError('That support access had already ended.');
    }
    return { sessionsEnded: await endSupportSessions(tx) };
  },
});

/**
 * Adds a Velyx support login: a Super Admin without ticks, marked as support, invited like any
 * staff member (IAM-06). It signs in only while support access is on.
 */
export const addSupportLogin = staffService({
  action: 'support_access.grant',
  input: supportLoginSchema,
  run: async (tx, { email, name }): Promise<InviteResult> => {
    if (await staffEmailTaken(tx, email)) {
      throw new SupportActionError('A staff member with this email already exists.');
    }
    const staffUserId = await insertStaffMember(tx, {
      email,
      details: {
        name,
        role: 'super_admin',
        treatsPatients: false,
        consultant: false,
        centreIds: [],
      },
      velyxSupport: true,
    });
    const invite = await sendInvite(email);
    await linkStaffLogin(tx, staffUserId, invite.authUserId);
    await recordAccessEvent(tx, { action: 'staff_invited', staffUserId });
    return { staffUserId, emailSent: invite.emailSent, tokenHash: invite.tokenHash };
  },
});
