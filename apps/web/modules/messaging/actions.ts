'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { NotAllowedError, ReadOnlyError } from '../access/guard';
import { serviceContext } from '../access/staff-db';
import { MessagingError, sendTestMessageService } from './services';

/** What the test message form shows after a post (WA-01). */
export interface TestMessageState {
  error?: string;
  notice?: string;
}

const text = (form: FormData, name: string) => {
  const value = form.get(name);
  return typeof value === 'string' ? value : '';
};

export async function sendTestMessageAction(
  _state: TestMessageState,
  form: FormData,
): Promise<TestMessageState> {
  try {
    await sendTestMessageService(await serviceContext(), { to: text(form, 'to') });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return { error: error.issues[0]?.message ?? 'That number could not be read.' };
    }
    if (error instanceof MessagingError || error instanceof ReadOnlyError) {
      return { error: error.message };
    }
    if (error instanceof NotAllowedError)
      return { error: 'Only the Super Admin sends a test message.' };
    throw error;
  }
  revalidatePath('/app/templates');
  return { notice: 'Queued. It goes within a minute.' };
}
