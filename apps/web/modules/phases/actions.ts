'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { NotAllowedError, ReadOnlyError } from '../access/guard';
import { serviceContext } from '../access/staff-db';
import { markPhaseCriterion, overridePhase, PhaseError, progressPhase } from './phases';

/** What a phase stepper form shows after a post (OUT-04). */
export interface PhaseFormState {
  error?: string;
  done?: boolean;
}

const text = (form: FormData, name: string) => {
  const value = form.get(name);
  return typeof value === 'string' ? value : '';
};

const phaseNumber = (form: FormData) => {
  const raw = text(form, 'toPhase');
  return raw === '' ? Number.NaN : Number(raw);
};

/** Runs a phase write; refusals and bad input become the form's message. */
async function phaseWrite(
  form: FormData,
  write: (episodeId: string) => Promise<unknown>,
  notAllowed: string,
): Promise<PhaseFormState> {
  try {
    await write(text(form, 'episodeId'));
  } catch (error) {
    if (error instanceof z.ZodError) {
      return { error: error.issues[0]?.message ?? 'That could not be read.' };
    }
    if (error instanceof PhaseError || error instanceof ReadOnlyError) {
      return { error: error.message };
    }
    if (error instanceof NotAllowedError) return { error: notAllowed };
    throw error;
  }
  revalidatePath(`/app/patients/${text(form, 'patientId')}`);
  return { done: true };
}

/** Met or Not yet on an exit criterion of the current phase. */
export async function markPhaseCriterionAction(
  _state: PhaseFormState,
  form: FormData,
): Promise<PhaseFormState> {
  return phaseWrite(
    form,
    async (episodeId) =>
      markPhaseCriterion(await serviceContext(), {
        episodeId,
        criterionKey: text(form, 'criterionKey'),
        result: text(form, 'result'),
      }),
    'Only the treating physio marks the exit criteria.',
  );
}

/** "Move to Phase n": the treating physio, once every exit criterion is Met. */
export async function progressPhaseAction(
  _state: PhaseFormState,
  form: FormData,
): Promise<PhaseFormState> {
  return phaseWrite(
    form,
    async (episodeId) =>
      progressPhase(await serviceContext(), { episodeId, toPhase: phaseNumber(form) }),
    'Only the treating physio moves the patient on.',
  );
}

/** "Move phase": a consultant's override to any other phase, with the reason. */
export async function overridePhaseAction(
  _state: PhaseFormState,
  form: FormData,
): Promise<PhaseFormState> {
  return phaseWrite(
    form,
    async (episodeId) =>
      overridePhase(await serviceContext(), {
        episodeId,
        toPhase: phaseNumber(form),
        reason: text(form, 'reason'),
      }),
    'Only consultants override the phase.',
  );
}
