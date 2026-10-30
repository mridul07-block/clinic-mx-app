import 'server-only';
import {
  activeExercises,
  exerciseRecord,
  insertExercise,
  myPlanExerciseVideo,
  retireExercise as retireExerciseRow,
  type ExerciseVideo,
  type LibraryExercise,
  type StaffMember,
} from '@clinic-mx/db';
import {
  exerciseInputSchema,
  exerciseVideoExtensions,
  exerciseVideoProblem,
  exerciseVideoType,
  type ExerciseVideoType,
} from '@clinic-mx/schemas';
import { z } from 'zod';
import { assertMay } from '../access/guard';
import { asPatient } from '../access/patient-db';
import { staffService } from '../access/service';
import { asStaff } from '../access/staff-db';
import { verifyPatientLink } from '../patient-links/services';
import { getSetting } from '../settings/settings';
import { exerciseMediaStore, type ExerciseMediaStore } from './media-store';

/**
 * The exercise library (SET-07; docs/runbooks/exercise-library.md). The Super Admin adds an
 * exercise with its default dose and, once the clinic films it, a short MP4 or WebM clip; replacing
 * one adds a new exercise and retires the old, so plans keep the one they were written with.
 * Clinicians pick from it for the home programme; patients watch the videos of their own plan's
 * exercises on My plan. Recommended defaults chosen under the user's standing approval, 30 October
 * 2026 (DECISION SET-07).
 */

export class ExerciseError extends Error {}

/** The active library, for anyone signed in (the plan editor and the library screen). */
export async function loadExercises(staff: StaffMember): Promise<LibraryExercise[]> {
  return asStaff(staff, (tx) => activeExercises(tx));
}

/** The library screen: the Super Admin's. */
export async function loadLibrary(staff: StaffMember): Promise<LibraryExercise[]> {
  assertMay(staff, 'exercises.manage');
  return loadExercises(staff);
}

/**
 * A posted video checked and stored, first, outside the transaction: its path, kind and size;
 * undefined without one. The caller removes it unless the exercise is saved.
 */
export async function storedVideo(
  bytes: Uint8Array,
  store: ExerciseMediaStore,
): Promise<ExerciseVideo | undefined> {
  if (bytes.length === 0) return undefined;
  const problem = exerciseVideoProblem(bytes, await getSetting('exercises.video_max_mb'));
  if (problem) throw new ExerciseError(problem);
  const type = exerciseVideoType(bytes) as ExerciseVideoType;
  const path = `${crypto.randomUUID()}.${exerciseVideoExtensions[type]}`;
  await store.put(path, bytes, type);
  return { path, type, bytes: bytes.length };
}

const videoSchema = z
  .object({
    path: z.string().min(1).max(200),
    type: z.enum(['video/mp4', 'video/webm']),
    bytes: z.int().positive(),
  })
  .optional();

/** Adds an exercise to the library, with its stored video when there is one; audited. */
export const addExercise = staffService({
  action: 'exercises.manage',
  input: exerciseInputSchema.extend({ video: videoSchema }),
  run: async (tx, input, actor): Promise<{ id: string }> => ({
    id: await insertExercise(tx, {
      name: input.name,
      defaultDose: input.defaultDose,
      ...(input.video ? { video: input.video } : {}),
      by: actor.id,
    }),
  }),
});

/**
 * Replaces an exercise: a new one with the new name and dose, and the new video or else the old
 * one's; the old is retired, naming it. Plans written with the old keep it.
 */
export const replaceExercise = staffService({
  action: 'exercises.manage',
  input: exerciseInputSchema.extend({
    exerciseId: z.guid({ error: 'That exercise was not found.' }),
    video: videoSchema,
  }),
  run: async (tx, input, actor): Promise<{ id: string }> => {
    const old = await exerciseRecord(tx, input.exerciseId);
    if (!old || old.retired) throw new ExerciseError('That exercise is no longer in the library.');
    const kept: ExerciseVideo | undefined =
      old.video && old.videoPath
        ? { path: old.videoPath, type: old.video.type, bytes: old.video.bytes }
        : undefined;
    const video = input.video ?? kept;
    const id = await insertExercise(tx, {
      name: input.name,
      defaultDose: input.defaultDose,
      ...(video ? { video } : {}),
      by: actor.id,
    });
    if (!(await retireExerciseRow(tx, old.id, id))) {
      throw new ExerciseError('That exercise is no longer in the library.');
    }
    return { id };
  },
});

/** Removes an exercise from the library (retired; plans written with it keep it). */
export const retireExercise = staffService({
  action: 'exercises.manage',
  input: z.object({ exerciseId: z.guid({ error: 'That exercise was not found.' }) }),
  run: async (tx, input): Promise<{ status: 'retired' }> => {
    if (!(await retireExerciseRow(tx, input.exerciseId))) {
      throw new ExerciseError('That exercise is no longer in the library.');
    }
    return { status: 'retired' };
  },
});

/** An exercise's video for staff (the library screen, the plan editor); undefined without one. */
export async function staffExerciseVideo(
  staff: StaffMember,
  exerciseId: string,
  store: ExerciseMediaStore = exerciseMediaStore(),
): Promise<{ bytes: Uint8Array; type: ExerciseVideoType } | undefined> {
  const found = await asStaff(staff, (tx) => exerciseRecord(tx, exerciseId));
  if (!found?.video || !found.videoPath) return undefined;
  return { bytes: await store.get(found.videoPath), type: found.video.type };
}

/**
 * An exercise's video for the patient behind a My plan link: only for an exercise in their own
 * plan (`internal.my_plan_exercise_video`); undefined otherwise.
 */
export async function patientExerciseVideo(
  token: string,
  exerciseId: string,
  options: { ip?: string; store?: ExerciseMediaStore } = {},
): Promise<{ bytes: Uint8Array; type: ExerciseVideoType } | undefined> {
  const opened = await verifyPatientLink(token);
  if (opened.status !== 'valid' || opened.link.purpose !== 'my_plan') return undefined;
  const found = await asPatient(
    opened.link,
    (tx) => myPlanExerciseVideo(tx, exerciseId),
    options.ip,
  );
  if (!found) return undefined;
  const store = options.store ?? exerciseMediaStore();
  return { bytes: await store.get(found.path), type: found.type };
}
