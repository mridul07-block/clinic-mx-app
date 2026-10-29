'use server';

import type { PatientContentPart } from '@clinic-mx/schemas';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { NotAllowedError, ReadOnlyError } from '../access/guard';
import { serviceContext } from '../access/staff-db';
import { PatientContentError, approveDraft, discardDraft, saveDraft } from './patient-content';

/** What the draft form shows after a post (AI-07). */
export interface PatientContentFormState {
  error?: string;
  /** A message per part. */
  errors?: Partial<Record<PatientContentPart, string>>;
  /** What was typed, given back with an error so the form keeps it. */
  values?: Partial<Record<PatientContentPart, string>>;
  saved?: boolean;
}

const text = (form: FormData, name: string) => {
  const value = form.get(name);
  return typeof value === 'string' ? value : '';
};

function failure(error: unknown): PatientContentFormState {
  if (error instanceof z.ZodError) {
    const errors: Partial<Record<PatientContentPart, string>> = {};
    for (const issue of error.issues) {
      const key = issue.path[0];
      if (typeof key === 'string' && !(key in errors)) {
        errors[key as PatientContentPart] = issue.message;
      }
    }
    return { errors, error: error.issues[0]?.message ?? 'Check the form.' };
  }
  if (error instanceof PatientContentError || error instanceof ReadOnlyError) {
    return { error: error.message };
  }
  if (error instanceof NotAllowedError) {
    return { error: 'Only a consultant who treats patients writes and approves patient content.' };
  }
  throw error;
}

const pathOf = (conditionId: string) =>
  ['/app/knowledge-base/patient-content', conditionId].join('/');

/** Saves the condition's draft, then shows it saved. */
export async function savePatientContentAction(
  _state: PatientContentFormState,
  form: FormData,
): Promise<PatientContentFormState> {
  const conditionId = text(form, 'conditionId');
  const values = {
    explanation: text(form, 'explanation'),
    roadmap: text(form, 'roadmap'),
    homeAdvice: text(form, 'homeAdvice'),
    warningSigns: text(form, 'warningSigns'),
  };
  try {
    const draftId = text(form, 'draftId');
    await saveDraft(await serviceContext(), {
      conditionId,
      ...values,
      ...(draftId ? { draftId, revision: text(form, 'revision') } : {}),
    });
  } catch (error) {
    return { ...failure(error), values };
  }
  revalidatePath(pathOf(conditionId));
  return { saved: true };
}

/** What the approve and discard buttons show after a post. */
export interface PatientContentDecisionState {
  error?: string;
}

async function deciding(
  form: FormData,
  decide: typeof approveDraft,
  done: string,
): Promise<PatientContentDecisionState> {
  const conditionId = text(form, 'conditionId');
  try {
    await decide(await serviceContext(), {
      conditionId,
      draftId: text(form, 'draftId'),
      revision: text(form, 'revision'),
    });
  } catch (error) {
    return { error: failure(error).error };
  }
  revalidatePath('/app/knowledge-base/patient-content');
  revalidatePath(pathOf(conditionId));
  redirect(`${pathOf(conditionId)}?done=${done}`);
}

/** Approves the draft read on the page: patients see it from now on. */
export async function approvePatientContentAction(
  _state: PatientContentDecisionState,
  form: FormData,
): Promise<PatientContentDecisionState> {
  return deciding(form, approveDraft, 'approved');
}

/** Discards the draft read on the page. */
export async function discardPatientContentAction(
  _state: PatientContentDecisionState,
  form: FormData,
): Promise<PatientContentDecisionState> {
  return deciding(form, discardDraft, 'discarded');
}
