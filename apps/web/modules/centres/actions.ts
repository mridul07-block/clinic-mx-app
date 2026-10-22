'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { NotAllowedError, ReadOnlyError } from '../access/guard';
import { serviceContext } from '../access/staff-db';
import { CentreError, addCentre, editCentre, setCentreActiveService } from './services';

/** What a centre form shows after a post (SET-01). */
export interface CentreFormState {
  error?: string;
  /** Messages by field: name, code, address, phone, mapLink, colour. */
  fieldErrors?: Record<string, string>;
  /** What was typed, given back with an error so the form keeps it. */
  values?: Record<string, string>;
}

const LIST = '/app/centres';

const text = (form: FormData, name: string) => {
  const value = form.get(name);
  return typeof value === 'string' ? value : '';
};

const detailsFrom = (form: FormData) => ({
  name: text(form, 'name'),
  address: text(form, 'address'),
  phone: text(form, 'phone'),
  mapLink: text(form, 'mapLink'),
  colour: text(form, 'colour'),
});

/** Refusals and bad input become messages; anything else is ours and is thrown. */
function failure(error: unknown): CentreFormState {
  if (error instanceof z.ZodError) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of error.issues) {
      const field = String(issue.path.at(-1) ?? 'form');
      fieldErrors[field] ??= issue.message;
    }
    return { error: 'Check the highlighted fields.', fieldErrors };
  }
  if (error instanceof CentreError || error instanceof ReadOnlyError) {
    return { error: error.message };
  }
  if (error instanceof NotAllowedError) return { error: 'You do not have access to centres.' };
  throw error;
}

export async function addCentreAction(
  _state: CentreFormState,
  form: FormData,
): Promise<CentreFormState> {
  const values = { ...detailsFrom(form), code: text(form, 'code') };
  let centreId: string;
  try {
    centreId = await addCentre(await serviceContext(), values);
  } catch (error) {
    return { ...failure(error), values };
  }
  revalidatePath(LIST);
  redirect(`${LIST}/${centreId}?done=added`);
}

export async function editCentreAction(
  _state: CentreFormState,
  form: FormData,
): Promise<CentreFormState> {
  const values = detailsFrom(form);
  const centreId = text(form, 'centreId');
  try {
    await editCentre(await serviceContext(), { centreId, ...values });
  } catch (error) {
    return { ...failure(error), values };
  }
  revalidatePath(LIST);
  redirect(`${LIST}/${centreId}?done=saved`);
}

export async function setCentreActiveAction(
  _state: CentreFormState,
  form: FormData,
): Promise<CentreFormState> {
  const centreId = text(form, 'centreId');
  const active = text(form, 'active') === 'true';
  try {
    await setCentreActiveService(await serviceContext(), { centreId, active });
  } catch (error) {
    return failure(error);
  }
  revalidatePath(LIST);
  redirect(`${LIST}/${centreId}?done=${active ? 'reactivated' : 'deactivated'}`);
}
