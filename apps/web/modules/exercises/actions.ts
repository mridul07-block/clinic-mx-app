'use server';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { NotAllowedError, ReadOnlyError } from '../access/guard';
import { serviceContext } from '../access/staff-db';
import { exerciseMediaStore } from './media-store';
import {
  ExerciseError,
  addExercise,
  replaceExercise,
  retireExercise,
  storedVideo,
} from './services';

/** What a library form shows after a post (SET-07). */
export interface ExerciseFormState {
  error?: string;
  done?: string;
  /** Counts posts, so a saved form starts empty again. */
  attempt?: number;
  /** What was typed, given back after a refusal so the form keeps it. */
  values?: { name: string; defaultDose: string };
}

const field = (form: FormData, name: string) => {
  const value = form.get(name);
  return typeof value === 'string' ? value : '';
};

/** The posted video's bytes; empty without one. */
async function videoBytes(form: FormData): Promise<Uint8Array> {
  const file = form.get('video');
  if (!(file instanceof File) || file.size === 0) return new Uint8Array();
  return new Uint8Array(await file.arrayBuffer());
}

/** Refusals in words; anything else is ours and is thrown. */
function refusal(error: unknown): string {
  if (error instanceof z.ZodError) return error.issues[0]?.message ?? 'Try again.';
  if (error instanceof ExerciseError || error instanceof ReadOnlyError) return error.message;
  if (error instanceof NotAllowedError) return 'Only the Super Admin keeps the exercise library.';
  throw error;
}

/**
 * Stores the video first (outside the transaction), then saves; the stored video is removed
 * unless the exercise is saved.
 */
async function withVideo(
  form: FormData,
  save: (video: Awaited<ReturnType<typeof storedVideo>>) => Promise<unknown>,
): Promise<string | undefined> {
  const store = exerciseMediaStore();
  let video: Awaited<ReturnType<typeof storedVideo>>;
  try {
    video = await storedVideo(await videoBytes(form), store);
  } catch (error) {
    return refusal(error);
  }
  try {
    await save(video);
    return undefined;
  } catch (error) {
    if (video) await store.remove([video.path]);
    return refusal(error);
  }
}

/** "Add to library". */
export async function addExerciseAction(
  state: ExerciseFormState,
  form: FormData,
): Promise<ExerciseFormState> {
  const name = field(form, 'name');
  const defaultDose = field(form, 'defaultDose');
  const error = await withVideo(form, async (video) =>
    addExercise(await serviceContext(), { name, defaultDose, ...(video ? { video } : {}) }),
  );
  if (error) return { error, attempt: state.attempt ?? 0, values: { name, defaultDose } };
  revalidatePath('/app/exercises');
  return { done: `Added ${name.trim()}.`, attempt: (state.attempt ?? 0) + 1 };
}

/** "Save as a new version": the old one is retired; plans written with it keep it. */
export async function replaceExerciseAction(
  state: ExerciseFormState,
  form: FormData,
): Promise<ExerciseFormState> {
  const name = field(form, 'name');
  const defaultDose = field(form, 'defaultDose');
  const error = await withVideo(form, async (video) =>
    replaceExercise(await serviceContext(), {
      exerciseId: field(form, 'exerciseId'),
      name,
      defaultDose,
      ...(video ? { video } : {}),
    }),
  );
  if (error) return { error, attempt: state.attempt ?? 0, values: { name, defaultDose } };
  revalidatePath('/app/exercises');
  return { done: 'Saved.', attempt: (state.attempt ?? 0) + 1 };
}

/** "Remove from library". */
export async function retireExerciseAction(
  _state: ExerciseFormState,
  form: FormData,
): Promise<ExerciseFormState> {
  try {
    await retireExercise(await serviceContext(), { exerciseId: field(form, 'exerciseId') });
  } catch (error) {
    return { error: refusal(error) };
  }
  revalidatePath('/app/exercises');
  return { done: 'Removed.' };
}
