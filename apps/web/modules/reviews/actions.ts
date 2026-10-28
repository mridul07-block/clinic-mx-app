'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { NotAllowedError, ReadOnlyError } from '../access/guard';
import { serviceContext } from '../access/staff-db';
import {
  markReadinessCheck,
  overrideReadinessCriterion,
  recordReadinessMeasure,
  signReadinessClearance,
} from './readiness';
import { confirmEpisodeDiagnosis } from './confirm-diagnosis';
import { dischargeEpisode } from './discharge';
import { ReviewError, signFinalTest } from './services';

/** What the final testing form shows after a post (OUT-07). */
export interface FinalTestState {
  error?: string;
  signed?: boolean;
}

const text = (form: FormData, name: string) => {
  const value = form.get(name);
  return typeof value === 'string' ? value : '';
};

const entriesOf = (form: FormData): unknown => {
  try {
    return JSON.parse(text(form, 'entries')) as unknown;
  } catch {
    return {};
  }
};

/** "Sign final testing": refusals and bad input become messages; anything else is thrown. */
export async function signFinalTestAction(
  _state: FinalTestState,
  form: FormData,
): Promise<FinalTestState> {
  const episodeId = text(form, 'episodeId');
  try {
    await signFinalTest(await serviceContext(), { episodeId, entries: entriesOf(form) });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return { error: error.issues[0]?.message ?? 'That could not be read.' };
    }
    if (error instanceof ReviewError || error instanceof ReadOnlyError) {
      return { error: error.message };
    }
    if (error instanceof NotAllowedError) {
      return { error: 'Only consultants sign final testing.' };
    }
    throw error;
  }
  revalidatePath(`/app/episodes/${episodeId}/review`);
  return { signed: true };
}

/** What a readiness form shows after a post (OUT-08). */
export interface ReadinessFormState {
  error?: string;
  done?: boolean;
}

const numberOrNull = (form: FormData, name: string) => {
  const raw = text(form, name).trim();
  if (raw === '') return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : Number.NaN;
};

/** Runs a readiness write; refusals and bad input become the form's message. */
async function readinessWrite(
  episodeId: string,
  write: () => Promise<unknown>,
): Promise<ReadinessFormState> {
  try {
    await write();
  } catch (error) {
    if (error instanceof z.ZodError) {
      return { error: error.issues[0]?.message ?? 'That could not be read.' };
    }
    if (error instanceof ReviewError || error instanceof ReadOnlyError) {
      return { error: error.message };
    }
    if (error instanceof NotAllowedError) {
      return { error: 'Only consultants record readiness and sign clearances.' };
    }
    throw error;
  }
  revalidatePath(`/app/episodes/${episodeId}/review`);
  return { done: true };
}

/** A yes or no criterion's Met, Not met or Not assessed. */
export async function markReadinessCheckAction(
  _state: ReadinessFormState,
  form: FormData,
): Promise<ReadinessFormState> {
  const episodeId = text(form, 'episodeId');
  return readinessWrite(episodeId, async () =>
    markReadinessCheck(await serviceContext(), {
      episodeId,
      criterionKey: text(form, 'criterionKey'),
      result: text(form, 'result'),
    }),
  );
}

/** "Save override": the written reason for a criterion not Met. */
export async function overrideReadinessAction(
  _state: ReadinessFormState,
  form: FormData,
): Promise<ReadinessFormState> {
  const episodeId = text(form, 'episodeId');
  return readinessWrite(episodeId, async () =>
    overrideReadinessCriterion(await serviceContext(), {
      episodeId,
      criterionKey: text(form, 'criterionKey'),
      reason: text(form, 'reason'),
    }),
  );
}

/** "Save reading": a reading for a measured criterion never measured. */
export async function recordReadinessReadingAction(
  _state: ReadinessFormState,
  form: FormData,
): Promise<ReadinessFormState> {
  const episodeId = text(form, 'episodeId');
  return readinessWrite(episodeId, async () =>
    recordReadinessMeasure(await serviceContext(), {
      episodeId,
      criterionKey: text(form, 'criterionKey'),
      involved: numberOrNull(form, 'involved'),
      uninvolved: numberOrNull(form, 'uninvolved'),
      value: numberOrNull(form, 'value'),
    }),
  );
}

/** "Sign Rehabilitation complete" and the two after it. */
export async function signClearanceAction(
  _state: ReadinessFormState,
  form: FormData,
): Promise<ReadinessFormState> {
  const episodeId = text(form, 'episodeId');
  return readinessWrite(episodeId, async () =>
    signReadinessClearance(await serviceContext(), { episodeId, status: text(form, 'status') }),
  );
}

/** "Discharge" (OUT-10): the reason and note; refusals and bad input become the form's message. */
export async function dischargeEpisodeAction(
  _state: ReadinessFormState,
  form: FormData,
): Promise<ReadinessFormState> {
  const episodeId = text(form, 'episodeId');
  const note = text(form, 'note').trim();
  // One radio group per goal, `goal-<n>`; an unmarked one reads '' and is refused.
  const goals = Array.from(
    { length: Math.min(Number(text(form, 'goalCount')) || 0, 21) },
    (_, index) => text(form, ['goal', String(index)].join('-')),
  );
  const ongoingNeeds = text(form, 'ongoingNeeds').trim();
  const recommendations = text(form, 'recommendations').trim();
  const returnPlan = text(form, 'returnPlan').trim();
  const flarePlan = text(form, 'flarePlan').trim();
  try {
    await dischargeEpisode(await serviceContext(), {
      episodeId,
      reason: text(form, 'reason') || undefined,
      ...(note ? { note } : {}),
      goals,
      ...(ongoingNeeds ? { ongoingNeeds } : {}),
      ...(recommendations ? { recommendations } : {}),
      ...(returnPlan ? { returnPlan } : {}),
      ...(flarePlan ? { flarePlan } : {}),
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return { error: error.issues[0]?.message ?? 'That could not be read.' };
    }
    if (error instanceof ReviewError || error instanceof ReadOnlyError) {
      return { error: error.message };
    }
    if (error instanceof NotAllowedError) {
      return { error: 'Only consultants discharge an episode.' };
    }
    throw error;
  }
  revalidatePath(`/app/episodes/${episodeId}/review`);
  return { done: true };
}

/** "Confirm" (AI-05): the episode's diagnosis confirmed or changed; refusals become the message. */
export async function confirmDiagnosisAction(
  _state: ReadinessFormState,
  form: FormData,
): Promise<ReadinessFormState> {
  const episodeId = text(form, 'episodeId');
  try {
    await confirmEpisodeDiagnosis(await serviceContext(), {
      episodeId,
      conditionId: text(form, 'conditionId'),
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return { error: error.issues[0]?.message ?? 'That could not be read.' };
    }
    if (error instanceof ReviewError || error instanceof ReadOnlyError) {
      return { error: error.message };
    }
    if (error instanceof NotAllowedError) {
      return { error: 'Only consultants confirm a diagnosis.' };
    }
    throw error;
  }
  revalidatePath(`/app/episodes/${episodeId}/review`);
  return { done: true };
}
