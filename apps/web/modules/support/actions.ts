'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { NotAllowedError, ReadOnlyError } from '../access/guard';
import { serviceContext } from '../access/staff-db';
import { inviteUrl } from '../staff/invite-url';
import {
  SupportActionError,
  addSupportLogin,
  endSupportAccess,
  grantSupportAccess,
} from './services';

/** What a support access form shows after a post (IAM-08). */
export interface SupportFormState {
  error?: string;
  /** Messages by field: hours, reason, email, name. */
  fieldErrors?: Record<string, string>;
  notice?: string;
  /** An invite link to show once, when a support login's invite email was not sent. */
  inviteLink?: string;
  /** What was typed, given back with an error so the form keeps it. */
  values?: Record<string, string>;
}

const PAGE = '/app/support-access';

const text = (form: FormData, name: string) => {
  const value = form.get(name);
  return typeof value === 'string' ? value : '';
};

/** Refusals and bad input become messages; anything else is ours and is thrown. */
function failure(error: unknown): SupportFormState {
  if (error instanceof z.ZodError) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of error.issues) {
      const field = String(issue.path.at(-1) ?? 'form');
      fieldErrors[field] ??= issue.message;
    }
    return { error: 'Check the highlighted fields.', fieldErrors };
  }
  if (error instanceof SupportActionError || error instanceof ReadOnlyError) {
    return { error: error.message };
  }
  if (error instanceof NotAllowedError) {
    return { error: 'You do not have access to support access.' };
  }
  throw error;
}

export async function grantSupportAction(
  _state: SupportFormState,
  form: FormData,
): Promise<SupportFormState> {
  const values = { hours: text(form, 'hours'), reason: text(form, 'reason') };
  try {
    await grantSupportAccess(await serviceContext(), values);
  } catch (error) {
    return { ...failure(error), values };
  }
  // The grant form gives way to the status, so the page says what happened.
  revalidatePath(PAGE);
  redirect(`${PAGE}?done=granted`);
}

export async function endSupportAction(
  _state: SupportFormState,
  form: FormData,
): Promise<SupportFormState> {
  try {
    await endSupportAccess(await serviceContext(), { grantId: text(form, 'grantId') });
  } catch (error) {
    return failure(error);
  }
  revalidatePath(PAGE);
  redirect(`${PAGE}?done=ended`);
}

export async function addSupportLoginAction(
  _state: SupportFormState,
  form: FormData,
): Promise<SupportFormState> {
  const values = { email: text(form, 'email'), name: text(form, 'name') };
  let result: Awaited<ReturnType<typeof addSupportLogin>>;
  try {
    result = await addSupportLogin(await serviceContext(), values);
  } catch (error) {
    return { ...failure(error), values };
  }
  revalidatePath(PAGE);
  revalidatePath('/app/staff');
  if (result.emailSent || !result.tokenHash) {
    return { notice: 'Support login added and invite sent. It signs in only while access is on.' };
  }
  return {
    notice:
      'Support login added, but the invite email could not be sent. Send them this link another way.',
    inviteLink: await inviteUrl(result.tokenHash),
  };
}
