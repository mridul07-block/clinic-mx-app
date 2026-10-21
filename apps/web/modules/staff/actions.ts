'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { NotAllowedError } from '../access/guard';
import { serviceContext } from '../access/staff-db';
import {
  StaffActionError,
  createInviteLink,
  inviteStaff,
  resetStaffTwoStep,
  sendInviteAgain,
  setStaffActive,
  updateStaff,
} from './services';

/** What a staff form shows after a post (IAM-06). */
export interface StaffFormState {
  error?: string;
  /** Messages by field: name, email, role, consultant, centreIds, accessEndsOn. */
  fieldErrors?: Record<string, string>;
  notice?: string;
  /** An invite link to show once, when the email was not sent or a link was asked for. */
  inviteLink?: string;
  /** The staff member the invite created. */
  staffUserId?: string;
}

const text = (form: FormData, name: string) => {
  const value = form.get(name);
  return typeof value === 'string' ? value : '';
};

function detailsFrom(form: FormData) {
  return {
    name: text(form, 'name'),
    role: text(form, 'role'),
    treatsPatients: form.get('treatsPatients') === 'on',
    consultant: form.get('consultant') === 'on',
    centreIds: form.getAll('centreIds').filter((value) => typeof value === 'string'),
    accessEndsOn: text(form, 'accessEndsOn') || undefined,
  };
}

/** Our own address for this request, for invite links (never supabase.co, rule 9). */
async function inviteUrl(tokenHash: string): Promise<string> {
  const request = await headers();
  const host = request.get('x-forwarded-host') ?? request.get('host') ?? 'localhost:3000';
  const protocol =
    request.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https');
  const query = new URLSearchParams({ token_hash: tokenHash, type: 'invite' });
  return `${protocol}://${host}/app/reset-password?${query.toString()}`;
}

/** Refusals and bad input become messages; anything else is ours and is thrown. */
function failure(error: unknown): StaffFormState {
  if (error instanceof z.ZodError) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of error.issues) {
      const field = String(issue.path.at(-1) ?? 'form');
      fieldErrors[field] ??= issue.message;
    }
    return { error: 'Check the highlighted fields.', fieldErrors };
  }
  if (error instanceof StaffActionError) return { error: error.message };
  if (error instanceof NotAllowedError)
    return { error: 'You do not have access to staff management.' };
  throw error;
}

export async function inviteStaffAction(
  _state: StaffFormState,
  form: FormData,
): Promise<StaffFormState> {
  let result: Awaited<ReturnType<typeof inviteStaff>>;
  try {
    result = await inviteStaff(await serviceContext(), {
      email: text(form, 'email'),
      details: detailsFrom(form),
    });
  } catch (error) {
    return failure(error);
  }
  revalidatePath('/app/staff');
  if (result.emailSent || !result.tokenHash) {
    redirect(`/app/staff/${result.staffUserId}?invited=sent`);
  }
  return {
    staffUserId: result.staffUserId,
    notice:
      'They were added, but the invite email could not be sent. Send them this link another way.',
    inviteLink: await inviteUrl(result.tokenHash),
  };
}

export async function updateStaffAction(
  _state: StaffFormState,
  form: FormData,
): Promise<StaffFormState> {
  try {
    await updateStaff(await serviceContext(), {
      staffUserId: text(form, 'staffUserId'),
      details: detailsFrom(form),
    });
  } catch (error) {
    return failure(error);
  }
  revalidatePath('/app/staff');
  return { notice: 'Changes saved. They apply from their next page.' };
}

export async function staffAccountAction(
  _state: StaffFormState,
  form: FormData,
): Promise<StaffFormState> {
  const staffUserId = text(form, 'staffUserId');
  try {
    const context = await serviceContext();
    switch (text(form, 'intent')) {
      case 'deactivate':
        await setStaffActive(context, { staffUserId, active: false });
        revalidatePath('/app/staff');
        return { notice: 'Deactivated. They are signed out on their next page.' };
      case 'reactivate':
        await setStaffActive(context, { staffUserId, active: true });
        revalidatePath('/app/staff');
        return { notice: 'Reactivated. They can sign in again.' };
      case 'invite-again': {
        const sent = await sendInviteAgain(context, { staffUserId });
        if (sent.emailSent || !sent.tokenHash) return { notice: 'Invite sent again.' };
        return {
          notice: 'The invite email could not be sent. Send them this link another way.',
          inviteLink: await inviteUrl(sent.tokenHash),
        };
      }
      case 'invite-link': {
        const { tokenHash } = await createInviteLink(context, { staffUserId });
        return {
          notice: 'Send them this link. It works once, and replaces the link in their email.',
          inviteLink: await inviteUrl(tokenHash),
        };
      }
      case 'reset-two-step': {
        const { removed } = await resetStaffTwoStep(context, { staffUserId });
        return {
          notice:
            removed > 0
              ? 'Two step verification reset. Their next sign in asks them to set it up again.'
              : 'They had no authenticator app to remove.',
        };
      }
      default:
        return { error: 'That action is not known.' };
    }
  } catch (error) {
    return failure(error);
  }
}
