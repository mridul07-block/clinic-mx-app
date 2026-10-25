'use server';

import { planChoiceFromForm } from '@clinic-mx/schemas';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { NotAllowedError, ReadOnlyError } from '../access/guard';
import { serviceContext } from '../access/staff-db';
import { BillError, makeConsultationBill } from './bills';
import { PlanChoiceError, recordPatientPlanChoice } from './plan-choice';

/** What the patient choice form shows after a post (BIL-02). */
export interface PlanChoiceFormState {
  error?: string;
  done?: boolean;
  /** The option picked, given back with a refusal: the form resets after each post (React 19). */
  option?: string;
}

const text = (form: FormData, name: string) => {
  const value = form.get(name);
  return typeof value === 'string' ? value : '';
};

/** Refusals become messages; anything else is ours and is thrown. */
function failure(error: unknown): string {
  if (error instanceof z.ZodError) {
    return error.issues[0]?.message ?? 'That could not be read.';
  }
  if (
    error instanceof PlanChoiceError ||
    error instanceof BillError ||
    error instanceof ReadOnlyError
  ) {
    return error.message;
  }
  if (error instanceof NotAllowedError) {
    return 'Only the front desk at this centre, Finance or the Super Admin records the choice.';
  }
  throw error;
}

/** Records the patient's choice on the plan and payment sheet. */
export async function recordPlanChoiceAction(
  _state: PlanChoiceFormState,
  form: FormData,
): Promise<PlanChoiceFormState> {
  const episodeId = text(form, 'episodeId');
  const option = text(form, 'option');
  try {
    await recordPatientPlanChoice(await serviceContext(), {
      episodeId,
      choice: planChoiceFromForm(option, text(form, 'session')),
    });
  } catch (error) {
    return { error: failure(error), option };
  }
  revalidatePath(['/app/plans', episodeId].join('/'));
  return { done: true };
}

/** What "Make the consultation bill" shows after a post (BIL-05). */
export interface BillFormState {
  error?: string;
  done?: boolean;
}

/** Makes the consultation fee bill once the consultant's fee is set. */
export async function makeConsultationBillAction(
  _state: BillFormState,
  form: FormData,
): Promise<BillFormState> {
  const episodeId = text(form, 'episodeId');
  try {
    await makeConsultationBill(await serviceContext(), { episodeId });
  } catch (error) {
    return { error: failure(error) };
  }
  revalidatePath(['/app/plans', episodeId].join('/'));
  return { done: true };
}
