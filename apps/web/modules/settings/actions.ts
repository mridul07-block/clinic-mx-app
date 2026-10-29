'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { NotAllowedError, ReadOnlyError } from '../access/guard';
import { serviceContext } from '../access/staff-db';
import { SettingChangeError, changeSetting } from './services';
import { invalidateSettings } from './settings';

/** What one setting's form shows after a post (ADM-02). */
export interface SettingFormState {
  error?: string;
  /** What was typed, given back with an error so the form keeps it. */
  value?: string;
  done?: string;
}

const PAGE = '/app/settings';

const text = (form: FormData, name: string) => {
  const value = form.get(name);
  return typeof value === 'string' ? value : '';
};

/** "Save" on one setting. */
export async function changeSettingAction(
  _state: SettingFormState,
  form: FormData,
): Promise<SettingFormState> {
  const value = text(form, 'value');
  let result: 'saved' | 'unchanged';
  try {
    result = await changeSetting(await serviceContext(), {
      key: text(form, 'key'),
      value,
      seenAt: text(form, 'seenAt'),
    });
  } catch (error) {
    if (error instanceof SettingChangeError || error instanceof ReadOnlyError) {
      return { error: error.message, value };
    }
    if (error instanceof NotAllowedError) {
      return { error: 'Only the Super Admin changes settings.', value };
    }
    if (error instanceof z.ZodError) {
      const tooLong = error.issues.some((issue) => issue.path[0] === 'value');
      return {
        error: tooLong ? 'That value is too long.' : 'Reload the page and try again.',
        value,
      };
    }
    throw error;
  }
  if (result === 'unchanged') return { done: 'That is the value already. Nothing to save.' };
  invalidateSettings();
  revalidatePath(PAGE);
  return { done: 'Saved.' };
}
