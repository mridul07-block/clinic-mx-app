'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { NotAllowedError, ReadOnlyError } from '../access/guard';
import { serviceContext } from '../access/staff-db';
import { DataRequestError, closeRequest, recordDataRequest } from './services';

/** What a data request form shows after a post (ADM-03). */
export interface DataRequestFormState {
  error?: string;
  /** Messages by field. */
  fieldErrors?: Record<string, string>;
  /** What was typed, given back with an error so the form keeps it. */
  values?: Record<string, string>;
}

const PAGE = '/app/data-requests';

const text = (form: FormData, name: string) => {
  const value = form.get(name);
  return typeof value === 'string' ? value : '';
};

/** Refusals and bad input become messages; anything else is ours and is thrown. */
function failure(error: unknown, values: Record<string, string>): DataRequestFormState {
  if (error instanceof z.ZodError) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of error.issues) fieldErrors[issue.path.join('.') || 'form'] ??= issue.message;
    return { error: 'Check the highlighted fields.', fieldErrors, values };
  }
  if (error instanceof DataRequestError || error instanceof ReadOnlyError) {
    return { error: error.message, values };
  }
  if (error instanceof NotAllowedError) {
    return { error: 'Only the Super Admin records data requests.', values };
  }
  throw error;
}

/** "Record request", then its page. */
export async function recordDataRequestAction(
  _state: DataRequestFormState,
  form: FormData,
): Promise<DataRequestFormState> {
  const values = {
    patientId: text(form, 'patientId'),
    kind: text(form, 'kind'),
    receivedOn: text(form, 'receivedOn'),
    details: text(form, 'details'),
  };
  let id: string;
  try {
    id = await recordDataRequest(await serviceContext(), values);
  } catch (error) {
    return failure(error, values);
  }
  revalidatePath(PAGE);
  redirect([PAGE, id].join('/'));
}

/** "Close as done" or "Close as declined". */
export async function closeDataRequestAction(
  _state: DataRequestFormState,
  form: FormData,
): Promise<DataRequestFormState> {
  const values = {
    requestId: text(form, 'requestId'),
    status: text(form, 'status'),
    outcome: text(form, 'outcome'),
  };
  try {
    await closeRequest(await serviceContext(), values);
  } catch (error) {
    return failure(error, values);
  }
  revalidatePath(PAGE);
  revalidatePath([PAGE, values.requestId].join('/'));
  return {};
}
