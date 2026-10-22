'use server';

import type { PatientMatch } from '@clinic-mx/db';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { NotAllowedError, ReadOnlyError } from '../access/guard';
import { serviceContext } from '../access/staff-db';
import {
  PatientError,
  addGuardian,
  addPatient,
  editGuardian,
  editPatient,
  removeGuardianService,
} from './services';

/** What a patient form shows after a post (SCH-01). */
export interface PatientFormState {
  error?: string;
  /** Messages by field: name, phone, email, dateOfBirth, sex, occupation, registeredCentreId. */
  fieldErrors?: Record<string, string>;
  /** What was typed, given back with an error or the matches so the form keeps it. */
  values?: Record<string, string>;
  /** Patients already on the mobile typed; staff open one or confirm a new person. */
  matches?: PatientMatch[];
}

const LIST = '/app/patients';

const text = (form: FormData, name: string) => {
  const value = form.get(name);
  return typeof value === 'string' ? value : '';
};

const detailsFrom = (form: FormData) => ({
  name: text(form, 'name'),
  phone: text(form, 'phone'),
  email: text(form, 'email'),
  dateOfBirth: text(form, 'dateOfBirth'),
  sex: text(form, 'sex'),
  occupation: text(form, 'occupation'),
});

/** Refusals and bad input become messages; anything else is ours and is thrown. */
function failure(error: unknown): PatientFormState {
  if (error instanceof z.ZodError) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of error.issues) {
      const field = String(issue.path.at(-1) ?? 'form');
      fieldErrors[field] ??= issue.message;
    }
    return { error: 'Check the highlighted fields.', fieldErrors };
  }
  if (error instanceof PatientError || error instanceof ReadOnlyError) {
    return { error: error.message };
  }
  if (error instanceof NotAllowedError) {
    return { error: 'You cannot add or edit patients at that centre.' };
  }
  throw error;
}

export async function addPatientAction(
  _state: PatientFormState,
  form: FormData,
): Promise<PatientFormState> {
  const values = { ...detailsFrom(form), registeredCentreId: text(form, 'registeredCentreId') };
  let patientId: string;
  try {
    const result = await addPatient(await serviceContext(), {
      ...values,
      confirmNewPerson: text(form, 'confirmNewPerson') === 'true',
    });
    if (result.status === 'matches') return { matches: result.matches, values };
    patientId = result.id;
  } catch (error) {
    return { ...failure(error), values };
  }
  revalidatePath(LIST);
  redirect(`${LIST}/${patientId}?done=added`);
}

export async function editPatientAction(
  _state: PatientFormState,
  form: FormData,
): Promise<PatientFormState> {
  const values = detailsFrom(form);
  const patientId = text(form, 'patientId');
  try {
    await editPatient(await serviceContext(), { patientId, ...values });
  } catch (error) {
    return { ...failure(error), values };
  }
  revalidatePath(LIST);
  redirect(`${LIST}/${patientId}?done=saved`);
}

/** What a guardian form shows after a post (SCH-02). */
export interface GuardianFormState {
  error?: string;
  /** Messages by field: name, relationship, phone. */
  fieldErrors?: Record<string, string>;
  values?: Record<string, string>;
}

const guardianFrom = (form: FormData) => ({
  name: text(form, 'name'),
  relationship: text(form, 'relationship'),
  phone: text(form, 'phone'),
});

/** The patient's page, where guardians are kept; only a well formed id goes in the address. */
const patientPage = (patientId: string, done: string) =>
  `${LIST}/${z.guid().safeParse(patientId).success ? patientId : ''}?done=${done}`;

export async function addGuardianAction(
  _state: GuardianFormState,
  form: FormData,
): Promise<GuardianFormState> {
  const values = guardianFrom(form);
  const patientId = text(form, 'patientId');
  try {
    await addGuardian(await serviceContext(), { patientId, ...values });
  } catch (error) {
    return { ...failure(error), values };
  }
  revalidatePath(LIST);
  redirect(patientPage(patientId, 'guardian-added'));
}

export async function editGuardianAction(
  _state: GuardianFormState,
  form: FormData,
): Promise<GuardianFormState> {
  const values = guardianFrom(form);
  const patientId = text(form, 'patientId');
  try {
    await editGuardian(await serviceContext(), { guardianId: text(form, 'guardianId'), ...values });
  } catch (error) {
    return { ...failure(error), values };
  }
  revalidatePath(LIST);
  redirect(patientPage(patientId, 'guardian-saved'));
}

export async function removeGuardianAction(
  _state: GuardianFormState,
  form: FormData,
): Promise<GuardianFormState> {
  const patientId = text(form, 'patientId');
  try {
    await removeGuardianService(await serviceContext(), { guardianId: text(form, 'guardianId') });
  } catch (error) {
    return failure(error);
  }
  revalidatePath(LIST);
  redirect(patientPage(patientId, 'guardian-removed'));
}
