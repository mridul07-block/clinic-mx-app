'use server';

import type { PatientMatch } from '@clinic-mx/db';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { NotAllowedError, ReadOnlyError } from '../access/guard';
import { serviceContext } from '../access/staff-db';
import { invalidateSettings } from '../settings/settings';
import {
  OpeningEntryError,
  correctOpeningEntryService,
  createOpeningEntry,
  switchOpeningEntries,
} from './services';

/** What an opening entry form shows after a post (SCH-13). */
export interface OpeningEntryFormState {
  error?: string;
  /** Messages by field: name, phone, centreId, physioId, sessionsLeft, validUntil. */
  fieldErrors?: Record<string, string>;
  /** What was typed, given back with an error or the matches so the form keeps it. */
  values?: Record<string, string>;
  matches?: PatientMatch[];
  done?: string;
}

const PAGE = '/app/opening-entries';

const text = (form: FormData, name: string) => {
  const value = form.get(name);
  return typeof value === 'string' ? value : '';
};

const whole = (raw: string) => (raw.trim() === '' ? Number.NaN : Number(raw));

/** Refusals and bad input become messages; anything else is ours and is thrown. */
function failure(error: unknown): OpeningEntryFormState {
  if (error instanceof z.ZodError) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of error.issues) {
      const field = String(issue.path.at(-1) ?? 'form');
      fieldErrors[field] ??= issue.message;
    }
    return { error: 'Check the highlighted fields.', fieldErrors };
  }
  if (error instanceof OpeningEntryError || error instanceof ReadOnlyError) {
    return { error: error.message };
  }
  if (error instanceof NotAllowedError) {
    return { error: 'Only the Super Admin makes opening entries.' };
  }
  throw error;
}

/** "Add opening entry". */
export async function addOpeningEntryAction(
  _state: OpeningEntryFormState,
  form: FormData,
): Promise<OpeningEntryFormState> {
  const values = {
    name: text(form, 'name'),
    phone: text(form, 'phone'),
    centreId: text(form, 'centreId'),
    physioId: text(form, 'physioId'),
    sessionsLeft: text(form, 'sessionsLeft'),
    validUntil: text(form, 'validUntil'),
  };
  try {
    const result = await createOpeningEntry(await serviceContext(), {
      ...values,
      sessionsLeft: whole(values.sessionsLeft),
      confirmNewPerson: text(form, 'confirmNewPerson') === 'true',
    });
    if (result.status === 'matches') return { matches: result.matches, values };
    revalidatePath(PAGE);
    return { done: `${values.name.trim()} entered as ${result.opNumber}.` };
  } catch (error) {
    return { ...failure(error), values };
  }
}

/** "Save correction". */
export async function correctOpeningEntryAction(
  _state: OpeningEntryFormState,
  form: FormData,
): Promise<OpeningEntryFormState> {
  try {
    await correctOpeningEntryService(await serviceContext(), {
      entryId: text(form, 'entryId'),
      physioId: text(form, 'physioId'),
      sessionsLeft: whole(text(form, 'sessionsLeft')),
      validUntil: text(form, 'validUntil'),
    });
  } catch (error) {
    return failure(error);
  }
  revalidatePath(PAGE);
  return { done: 'Corrected.' };
}

/** "Close opening entries" and "Reopen opening entries". */
export async function switchOpeningEntriesAction(
  _state: OpeningEntryFormState,
  form: FormData,
): Promise<OpeningEntryFormState> {
  try {
    await switchOpeningEntries(await serviceContext(), { open: text(form, 'open') === 'true' });
  } catch (error) {
    return failure(error);
  }
  invalidateSettings();
  revalidatePath(PAGE);
  return {
    done: text(form, 'open') === 'true' ? 'Opening entries reopened.' : 'Opening entries closed.',
  };
}
