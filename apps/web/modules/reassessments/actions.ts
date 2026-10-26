'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { NotAllowedError, ReadOnlyError } from '../access/guard';
import { serviceContext } from '../access/staff-db';
import { ReassessmentError, signReassessmentDecision } from './services';

/** What the decision form shows after a post (OUT-05). */
export interface ReassessmentDecisionState {
  error?: string;
  signed?: boolean;
}

const text = (form: FormData, name: string) => {
  const value = form.get(name);
  return typeof value === 'string' ? value : '';
};

/** "Sign decision": refusals and bad input become messages; anything else is thrown. */
export async function signReassessmentAction(
  _state: ReassessmentDecisionState,
  form: FormData,
): Promise<ReassessmentDecisionState> {
  const reassessmentId = text(form, 'reassessmentId');
  try {
    await signReassessmentDecision(await serviceContext(), {
      reassessmentId,
      decision: text(form, 'decision'),
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return { error: error.issues[0]?.message ?? 'That could not be read.' };
    }
    if (error instanceof ReassessmentError || error instanceof ReadOnlyError) {
      return { error: error.message };
    }
    if (error instanceof NotAllowedError) return { error: 'Only consultants sign this decision.' };
    throw error;
  }
  revalidatePath(`/app/reassessments/${reassessmentId}`);
  revalidatePath('/app/tasks');
  return { signed: true };
}
