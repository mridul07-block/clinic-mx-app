'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { NotAllowedError, ReadOnlyError } from '../access/guard';
import { serviceContext } from '../access/staff-db';
import { ReviewError, signFinalTest } from './services';

/** What the final testing form shows after a post (OUT-07). */
export interface FinalTestState {
  error?: string;
  signed?: boolean;
}

const text = (form: FormData, name: string) => {
  const value = form.get(name);
  return typeof value === 'string' ? value : '';
};

const entriesOf = (form: FormData): unknown => {
  try {
    return JSON.parse(text(form, 'entries')) as unknown;
  } catch {
    return {};
  }
};

/** "Sign final testing": refusals and bad input become messages; anything else is thrown. */
export async function signFinalTestAction(
  _state: FinalTestState,
  form: FormData,
): Promise<FinalTestState> {
  const episodeId = text(form, 'episodeId');
  try {
    await signFinalTest(await serviceContext(), { episodeId, entries: entriesOf(form) });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return { error: error.issues[0]?.message ?? 'That could not be read.' };
    }
    if (error instanceof ReviewError || error instanceof ReadOnlyError) {
      return { error: error.message };
    }
    if (error instanceof NotAllowedError) {
      return { error: 'Only consultants sign final testing.' };
    }
    throw error;
  }
  revalidatePath(`/app/episodes/${episodeId}/review`);
  return { signed: true };
}
