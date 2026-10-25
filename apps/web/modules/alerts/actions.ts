'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { NotAllowedError, ReadOnlyError } from '../access/guard';
import { serviceContext } from '../access/staff-db';
import { EpisodeError } from '../episodes/services';
import {
  AlertError,
  closeAlert,
  recordConsultationRedFlag,
  referAlert,
  reviewAlert,
} from './services';

/** What an alert form shows after a post (ALT-01). */
export interface AlertFormState {
  error?: string;
  done?: boolean;
  /**
   * What was typed, given back with a refusal: the form resets after each post (React 19), so its
   * fields start from these rather than empty.
   */
  values?: Record<string, string>;
}

const text = (form: FormData, name: string) => {
  const value = form.get(name);
  return typeof value === 'string' ? value : '';
};

const typed = (form: FormData, names: readonly string[]) =>
  Object.fromEntries(names.map((name) => [name, text(form, name)]));

/** Refusals become messages; anything else is ours and is thrown. */
function failure(error: unknown): AlertFormState {
  if (error instanceof z.ZodError) {
    return { error: error.issues[0]?.message ?? 'That could not be read.' };
  }
  if (
    error instanceof AlertError ||
    error instanceof EpisodeError ||
    error instanceof ReadOnlyError
  ) {
    return { error: error.message };
  }
  if (error instanceof NotAllowedError) {
    return { error: 'Only a clinician at this centre acts on the alert.' };
  }
  throw error;
}

/** Every page shows the banner, so every page is drawn again after a change. */
function refreshEverywhere(): AlertFormState {
  revalidatePath('/app', 'layout');
  return { done: true };
}

/** "I'm reviewing", from the banner or the alert card. */
export async function reviewAlertAction(
  _state: AlertFormState,
  form: FormData,
): Promise<AlertFormState> {
  try {
    await reviewAlert(await serviceContext(), { alertId: text(form, 'alertId') });
  } catch (error) {
    return failure(error);
  }
  return refreshEverywhere();
}

export async function referAlertAction(
  _state: AlertFormState,
  form: FormData,
): Promise<AlertFormState> {
  try {
    await referAlert(await serviceContext(), {
      alertId: text(form, 'alertId'),
      referredTo: text(form, 'referredTo'),
      reason: text(form, 'reason'),
      question: text(form, 'question'),
    });
  } catch (error) {
    return { ...failure(error), values: typed(form, ['referredTo', 'reason', 'question']) };
  }
  return refreshEverywhere();
}

export async function closeAlertAction(
  _state: AlertFormState,
  form: FormData,
): Promise<AlertFormState> {
  try {
    await closeAlert(await serviceContext(), {
      alertId: text(form, 'alertId'),
      decision: text(form, 'decision'),
    });
  } catch (error) {
    return failure(error);
  }
  return refreshEverywhere();
}

/** A red flag found in the consultation (CLN-11), from its Screening step. */
export async function recordRedFlagAction(
  _state: AlertFormState,
  form: FormData,
): Promise<AlertFormState> {
  try {
    await recordConsultationRedFlag(await serviceContext(), {
      consultationId: text(form, 'consultationId'),
      triage: text(form, 'triage'),
      found: text(form, 'found'),
      referredTo: text(form, 'referredTo'),
      reason: text(form, 'reason'),
      question: text(form, 'question'),
    });
  } catch (error) {
    return {
      ...failure(error),
      values: typed(form, ['found', 'referredTo', 'reason', 'question']),
    };
  }
  return refreshEverywhere();
}
