'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { NotAllowedError } from '../access/guard';
import { serviceContext } from '../access/staff-db';
import { ConsultationError, addAddendumService, signConsultationService } from './services';

/** What the sign and addendum forms show after a post (CLN-09). */
export interface ConsultationFormState {
  error?: string;
  notice?: string;
}

const text = (form: FormData, name: string) => {
  const value = form.get(name);
  return typeof value === 'string' ? value : '';
};

/** Refusals and bad input become messages; anything else is ours and is thrown. */
function failure(error: unknown, notAllowed: string): ConsultationFormState {
  if (error instanceof z.ZodError) return { error: error.issues[0]?.message ?? 'Check the form.' };
  if (error instanceof ConsultationError) return { error: error.message };
  if (error instanceof NotAllowedError) return { error: notAllowed };
  throw error;
}

/** Signs the consultation at the saved version, then back to My patients today. */
export async function signConsultationAction(
  _state: ConsultationFormState,
  form: FormData,
): Promise<ConsultationFormState> {
  try {
    await signConsultationService(await serviceContext(), {
      consultationId: text(form, 'consultationId'),
      baseVersion: Number(text(form, 'baseVersion')),
    });
  } catch (error) {
    return failure(error, 'Signing needs the Consultant and Treats patients ticks.');
  }
  revalidatePath('/app/my-patients');
  redirect('/app/my-patients');
}

/** Adds an addendum to a signed consultation. */
export async function addAddendumAction(
  _state: ConsultationFormState,
  form: FormData,
): Promise<ConsultationFormState> {
  const consultationId = text(form, 'consultationId');
  try {
    await addAddendumService(await serviceContext(), {
      consultationId,
      text: text(form, 'text'),
    });
  } catch (error) {
    return failure(error, 'Adding an addendum needs the Treats patients tick.');
  }
  revalidatePath(`/app/consultations/${consultationId}`);
  // Added from the patient record's Notes (CLN-12).
  const patientId = text(form, 'patientId');
  if (z.guid().safeParse(patientId).success) revalidatePath(`/app/patients/${patientId}`);
  return { notice: 'Addendum added.' };
}
