'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { NotAllowedError, ReadOnlyError } from '../access/guard';
import { serviceContext } from '../access/staff-db';
import {
  AppointmentTypeError,
  addAppointmentType,
  editAppointmentType,
  setAppointmentTypeActiveService,
  setPhysioLengthsService,
} from './services';

/** What an appointment type or lengths form shows after a post (SET-03). */
export interface AppointmentTypeFormState {
  error?: string;
  /** Messages by field: name, minutes, or an appointment type id on the lengths form. */
  fieldErrors?: Record<string, string>;
  /** What was typed, given back with an error so the form keeps it. */
  values?: Record<string, string>;
  /** A notice after a save that stays on the page. */
  notice?: string;
}

const LIST = '/app/appointment-types';

const text = (form: FormData, name: string) => {
  const value = form.get(name);
  return typeof value === 'string' ? value : '';
};

/** Refusals and bad input become messages; anything else is ours and is thrown. */
function failure(
  error: unknown,
  fieldOf?: (path: PropertyKey[]) => string,
): AppointmentTypeFormState {
  if (error instanceof z.ZodError) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of error.issues) {
      const field =
        fieldOf?.(issue.path) ?? issue.path.find((part) => typeof part === 'string') ?? 'form';
      fieldErrors[field] ??= issue.message;
    }
    return { error: 'Check the highlighted fields.', fieldErrors };
  }
  if (error instanceof AppointmentTypeError) {
    return error.field
      ? { error: 'Check the highlighted fields.', fieldErrors: { [error.field]: error.message } }
      : { error: error.message };
  }
  if (error instanceof ReadOnlyError) return { error: error.message };
  if (error instanceof NotAllowedError) {
    return { error: 'You do not have access to appointment types.' };
  }
  throw error;
}

const detailsFrom = (form: FormData) => ({
  name: text(form, 'name'),
  minutes: text(form, 'minutes'),
});

export async function addAppointmentTypeAction(
  _state: AppointmentTypeFormState,
  form: FormData,
): Promise<AppointmentTypeFormState> {
  const values = detailsFrom(form);
  let id: string;
  try {
    id = await addAppointmentType(await serviceContext(), values);
  } catch (error) {
    return { ...failure(error), values };
  }
  revalidatePath(LIST);
  redirect(`${LIST}/${id}?done=added`);
}

export async function editAppointmentTypeAction(
  _state: AppointmentTypeFormState,
  form: FormData,
): Promise<AppointmentTypeFormState> {
  const values = detailsFrom(form);
  const appointmentTypeId = text(form, 'appointmentTypeId');
  try {
    await editAppointmentType(await serviceContext(), { appointmentTypeId, ...values });
  } catch (error) {
    return { ...failure(error), values };
  }
  revalidatePath(LIST);
  redirect(`${LIST}/${appointmentTypeId}?done=saved`);
}

export async function setAppointmentTypeActiveAction(
  _state: AppointmentTypeFormState,
  form: FormData,
): Promise<AppointmentTypeFormState> {
  const appointmentTypeId = text(form, 'appointmentTypeId');
  const active = text(form, 'active') === 'true';
  try {
    await setAppointmentTypeActiveService(await serviceContext(), { appointmentTypeId, active });
  } catch (error) {
    return failure(error);
  }
  revalidatePath(LIST);
  redirect(`${LIST}/${appointmentTypeId}?done=${active ? 'reactivated' : 'deactivated'}`);
}

/** The lengths form has a field `length:<appointment type id>` per type. */
const LENGTH = 'length:';

/** Sets a physio's own lengths from the staff page; stays on the page with a notice. */
export async function setPhysioLengthsAction(
  _state: AppointmentTypeFormState,
  form: FormData,
): Promise<AppointmentTypeFormState> {
  const staffUserId = text(form, 'staffUserId');
  const values: Record<string, string> = {};
  for (const [name, value] of form.entries()) {
    if (name.startsWith(LENGTH) && typeof value === 'string') {
      values[name.slice(LENGTH.length)] = value;
    }
  }
  const lengths = Object.entries(values).map(([appointmentTypeId, minutes]) => ({
    appointmentTypeId,
    minutes,
  }));
  try {
    await setPhysioLengthsService(await serviceContext(), { staffUserId, lengths });
  } catch (error) {
    // A bad length's message goes beside its type's field.
    const fieldOf = (path: PropertyKey[]) =>
      path[0] === 'lengths' && typeof path[1] === 'number'
        ? (lengths[path[1]]?.appointmentTypeId ?? 'form')
        : 'form';
    return { ...failure(error, fieldOf), values };
  }
  revalidatePath(`/app/staff/${staffUserId}`);
  revalidatePath(LIST);
  return { notice: 'Appointment lengths saved.', values };
}
