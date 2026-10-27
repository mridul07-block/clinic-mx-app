'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { NotAllowedError, ReadOnlyError } from '../access/guard';
import { serviceContext } from '../access/staff-db';
import { EpisodeError, linkRecurrence } from './services';

/** What the previous episodes panel shows after a post (SCH-14). */
export interface RecurrenceFormState {
  error?: string;
  done?: boolean;
}

const text = (form: FormData, name: string) => {
  const value = form.get(name);
  return typeof value === 'string' ? value : '';
};

/** Links the consultation's episode to an earlier one, or removes the link. */
export async function linkRecurrenceAction(
  _state: RecurrenceFormState,
  form: FormData,
): Promise<RecurrenceFormState> {
  const linked = text(form, 'linkedEpisodeId');
  try {
    await linkRecurrence(await serviceContext(), {
      episodeId: text(form, 'episodeId'),
      linkedEpisodeId: linked === '' ? null : linked,
    });
  } catch (error) {
    if (error instanceof z.ZodError) return { error: 'That could not be read.' };
    if (error instanceof EpisodeError || error instanceof ReadOnlyError) {
      return { error: error.message };
    }
    if (error instanceof NotAllowedError) {
      return { error: 'Only a consultant links a recurrence.' };
    }
    throw error;
  }
  revalidatePath(`/app/consultations/${text(form, 'consultationId')}`);
  revalidatePath(`/app/patients/${text(form, 'patientId')}`);
  return { done: true };
}
