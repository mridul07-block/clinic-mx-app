'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { NotAllowedError, ReadOnlyError } from '../access/guard';
import { serviceContext } from '../access/staff-db';
import { SessionError, addSessionAddendum, closeSession } from './services';

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

/** What the addendum form on a signed session note shows after a post. */
export interface SessionAddendumState {
  error?: string;
  notice?: string;
}

/**
 * Adds an addendum to a signed session note (CLN-12 follow up), from the session screen or the
 * patient record's Notes.
 */
export async function addSessionAddendumAction(
  _state: SessionAddendumState,
  form: FormData,
): Promise<SessionAddendumState> {
  let appointmentId: string;
  try {
    ({ appointmentId } = await addSessionAddendum(await serviceContext(), {
      sessionId: text(form, 'sessionId'),
      text: text(form, 'text'),
    }));
  } catch (error) {
    if (error instanceof z.ZodError)
      return { error: error.issues[0]?.message ?? 'Check the form.' };
    if (error instanceof SessionError || error instanceof ReadOnlyError) {
      return { error: error.message };
    }
    if (error instanceof NotAllowedError) {
      return { error: 'Adding an addendum needs the Treats patients tick.' };
    }
    throw error;
  }
  revalidatePath(`/app/sessions/${appointmentId}`);
  const patientId = text(form, 'patientId');
  if (z.guid().safeParse(patientId).success) revalidatePath(`/app/patients/${patientId}`);
  return { notice: 'Addendum added.' };
}
