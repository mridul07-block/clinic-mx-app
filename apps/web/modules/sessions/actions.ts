'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { NotAllowedError, ReadOnlyError } from '../access/guard';
import { serviceContext } from '../access/staff-db';
import { SessionError, closeSession } from './services';

/** What Close session shows after a post (SES-03). */
export interface CloseSessionState {
  error?: string;
}

const text = (form: FormData, name: string) => {
  const value = form.get(name);
  return typeof value === 'string' ? value : '';
};

/** Close session: signs the note at the version just saved, then back to My patients. */
export async function closeSessionAction(
  _state: CloseSessionState,
  form: FormData,
): Promise<CloseSessionState> {
  try {
    await closeSession(await serviceContext(), {
      appointmentId: text(form, 'appointmentId'),
      baseVersion: Number(text(form, 'baseVersion')),
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return { error: error.issues[0]?.message ?? 'That could not be read.' };
    }
    if (error instanceof SessionError || error instanceof ReadOnlyError) {
      return { error: error.message };
    }
    if (error instanceof NotAllowedError) {
      return { error: 'Closing a session needs the Treats patients tick.' };
    }
    throw error;
  }
  revalidatePath('/app/my-patients');
  redirect('/app/my-patients?closed=1');
}
