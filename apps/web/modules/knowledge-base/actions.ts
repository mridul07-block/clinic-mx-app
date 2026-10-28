'use server';

import { KnowledgeVersionNotApprovableError } from '@clinic-mx/db';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { NotAllowedError, ReadOnlyError } from '../access/guard';
import { serviceContext } from '../access/staff-db';
import { approveVersion } from './services';

/** What the approve form shows after a post (SET-06). */
export interface ApproveVersionState {
  error?: string;
  /** What was typed, given back with an error so the form keeps it. */
  values?: { notes: string; confirmed: boolean };
}

const text = (form: FormData, name: string) => {
  const value = form.get(name);
  return typeof value === 'string' ? value : '';
};

/** Refusals and bad input become messages; anything else is ours and is thrown. */
function failure(error: unknown): ApproveVersionState {
  if (error instanceof z.ZodError) return { error: error.issues[0]?.message ?? 'Check the form.' };
  if (error instanceof KnowledgeVersionNotApprovableError || error instanceof ReadOnlyError) {
    return { error: error.message };
  }
  if (error instanceof NotAllowedError) {
    return { error: 'Only the Super Admin approves a knowledge base version.' };
  }
  throw error;
}

/** Approves the version, then back to it, now live. */
export async function approveVersionAction(
  _state: ApproveVersionState,
  form: FormData,
): Promise<ApproveVersionState> {
  const versionId = text(form, 'versionId');
  const values = { notes: text(form, 'notes'), confirmed: form.get('confirmed') === 'on' };
  try {
    await approveVersion(await serviceContext(), { versionId, ...values });
  } catch (error) {
    return { ...failure(error), values };
  }
  revalidatePath('/app/knowledge-base');
  revalidatePath(`/app/knowledge-base/${versionId}`);
  redirect(`/app/knowledge-base/${versionId}?done=approved`);
}
