import 'server-only';
import {
  endStaffSessions,
  insertStaffMember,
  linkStaffLogin,
  recordAccessEvent,
  setStaffMemberActive,
  staffEmailTaken,
  staffRecord,
  updateStaffMember,
  type StaffRecord,
} from '@clinic-mx/db';
import {
  staffActiveSchema,
  staffInviteSchema,
  staffMemberRefSchema,
  staffUpdateSchema,
} from '@clinic-mx/schemas';
import { supabaseAdmin } from '../../lib/supabase/admin';
import { staffService, type ServiceTransaction } from '../access/service';

/**
 * Staff management for the Super Admin (IAM-06, PRD M16): invite, change role, ticks, centres and
 * end date, deactivate and reactivate, reset two step verification. Each is a staffService for
 * staff.manage, so it runs under row level security and every change is audited. Nothing here
 * deletes a staff member: their signed records stay attributed to them.
 */

/** A refusal to show the Super Admin as it is. */
export class StaffActionError extends Error {
  override name = 'StaffActionError';
}

/** An invite's outcome: whether Supabase sent the email, and a link to share when it did not. */
export interface InviteResult {
  staffUserId: string;
  emailSent: boolean;
  /** For an invite link on our domain (`/app/reset-password?token_hash=…&type=invite`). */
  tokenHash?: string;
}

async function existingMember(tx: ServiceTransaction, staffUserId: string): Promise<StaffRecord> {
  const member = await staffRecord(tx, staffUserId);
  if (!member) throw new StaffActionError('That staff member was not found.');
  return member;
}

/** A fresh invite link for a login that has not accepted its invite. Replaces earlier links. */
async function inviteToken(email: string): Promise<{ authUserId: string; tokenHash: string }> {
  const { data, error } = await supabaseAdmin().auth.admin.generateLink({ type: 'invite', email });
  if (error) {
    if (error.code === 'email_exists') {
      throw new StaffActionError('They have already accepted their invite.');
    }
    throw error;
  }
  return { authUserId: data.user.id, tokenHash: data.properties.hashed_token };
}

/**
 * Sends the invite email; if Supabase cannot send it (no email sender yet, a refused address),
 * makes an invite link instead for the Super Admin to share.
 */
async function sendInvite(
  email: string,
): Promise<{ authUserId: string; emailSent: boolean; tokenHash?: string }> {
  const { data, error } = await supabaseAdmin().auth.admin.inviteUserByEmail(email);
  if (!error) return { authUserId: data.user.id, emailSent: true };
  if (error.code === 'email_exists') {
    throw new StaffActionError('This email already has a Clinic Mx login.');
  }
  return { ...(await inviteToken(email)), emailSent: false };
}

export const inviteStaff = staffService({
  action: 'staff.manage',
  input: staffInviteSchema,
  run: async (tx, { email, details }): Promise<InviteResult> => {
    if (await staffEmailTaken(tx, email)) {
      throw new StaffActionError('A staff member with this email already exists.');
    }
    const staffUserId = await insertStaffMember(tx, { email, details });
    const invite = await sendInvite(email);
    await linkStaffLogin(tx, staffUserId, invite.authUserId);
    await recordAccessEvent(tx, { action: 'staff_invited', staffUserId });
    return { staffUserId, emailSent: invite.emailSent, tokenHash: invite.tokenHash };
  },
});

export const updateStaff = staffService({
  action: 'staff.manage',
  input: staffUpdateSchema,
  run: async (tx, { staffUserId, details }, actor) => {
    const member = await existingMember(tx, staffUserId);
    // The clinic must always keep a Super Admin who can sign in.
    if (staffUserId === actor.id && details.role !== member.role) {
      throw new StaffActionError('You cannot change your own role.');
    }
    await updateStaffMember(tx, staffUserId, details);
  },
});

export const setStaffActive = staffService({
  action: 'staff.manage',
  input: staffActiveSchema,
  run: async (tx, { staffUserId, active }, actor) => {
    await existingMember(tx, staffUserId);
    if (!active && staffUserId === actor.id) {
      throw new StaffActionError('You cannot deactivate yourself.');
    }
    await setStaffMemberActive(tx, staffUserId, active);
    // IAM-07: a deactivated person's sessions end at once, on every device.
    if (!active) await endStaffSessions(tx, staffUserId);
  },
});

export const sendInviteAgain = staffService({
  action: 'staff.manage',
  input: staffMemberRefSchema,
  run: async (tx, { staffUserId }): Promise<InviteResult> => {
    const member = await existingMember(tx, staffUserId);
    const invite = await sendInvite(member.email);
    await linkStaffLogin(tx, staffUserId, invite.authUserId);
    await recordAccessEvent(tx, { action: 'staff_invited', staffUserId });
    return { staffUserId, emailSent: invite.emailSent, tokenHash: invite.tokenHash };
  },
});

export const createInviteLink = staffService({
  action: 'staff.manage',
  input: staffMemberRefSchema,
  run: async (tx, { staffUserId }): Promise<{ tokenHash: string }> => {
    const member = await existingMember(tx, staffUserId);
    const { authUserId, tokenHash } = await inviteToken(member.email);
    await linkStaffLogin(tx, staffUserId, authUserId);
    await recordAccessEvent(tx, { action: 'invite_link_created', staffUserId });
    return { tokenHash };
  },
});

/**
 * Clears a staff member's authenticator apps when they lose or replace their phone (IAM-02,
 * decision 21 October 2026). Their next sign in asks them to set one up again (required roles)
 * or signs them in with the password (Front Desk). Audited as two_step_reset.
 */
export const resetStaffTwoStep = staffService({
  action: 'staff.manage',
  input: staffMemberRefSchema,
  run: async (tx, { staffUserId }): Promise<{ removed: number }> => {
    const member = await existingMember(tx, staffUserId);
    if (!member.authUserId) throw new StaffActionError('They have no login yet.');
    const admin = supabaseAdmin();
    const { data, error } = await admin.auth.admin.mfa.listFactors({ userId: member.authUserId });
    if (error) throw error;
    for (const factor of data.factors) {
      const removed = await admin.auth.admin.mfa.deleteFactor({
        userId: member.authUserId,
        id: factor.id,
      });
      if (removed.error) throw removed.error;
    }
    await recordAccessEvent(tx, { action: 'two_step_reset', staffUserId });
    return { removed: data.factors.length };
  },
});
