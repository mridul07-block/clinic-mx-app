import type { ExerciseVideoType } from '@clinic-mx/schemas';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { exercise } from './schema';
import type { DbOrTransaction } from './versioned';

/**
 * The exercise library (SET-07; docs/runbooks/exercise-library.md): the Super Admin adds and
 * retires exercises; staff read them; a patient reaches a video only for an exercise in their own
 * plan, through their My plan link (`internal.my_plan_exercise_video`).
 */

export interface LibraryExercise {
  id: string;
  name: string;
  defaultDose: string;
  video: { type: ExerciseVideoType; bytes: number } | null;
  createdAt: Date;
}

/** A video as our server fetches it from the private `exercise-media` bucket. */
export interface ExerciseVideo {
  path: string;
  type: ExerciseVideoType;
  bytes: number;
}

const columns = {
  id: exercise.id,
  name: exercise.name,
  defaultDose: exercise.defaultDose,
  videoType: exercise.videoType,
  videoBytes: exercise.videoBytes,
  createdAt: exercise.createdAt,
};

function libraryExercise(row: {
  id: string;
  name: string;
  defaultDose: string;
  videoType: ExerciseVideoType | null;
  videoBytes: number | null;
  createdAt: Date;
}): LibraryExercise {
  return {
    id: row.id,
    name: row.name,
    defaultDose: row.defaultDose,
    video: row.videoType && row.videoBytes ? { type: row.videoType, bytes: row.videoBytes } : null,
    createdAt: row.createdAt,
  };
}

/** The active exercises, by name. */
export async function activeExercises(db: DbOrTransaction): Promise<LibraryExercise[]> {
  const rows = await db
    .select(columns)
    .from(exercise)
    .where(isNull(exercise.retiredAt))
    .orderBy(asc(exercise.name), asc(exercise.createdAt));
  return rows.map(libraryExercise);
}

/** An exercise, active or retired, as staff read it. */
export async function exerciseRecord(
  db: DbOrTransaction,
  id: string,
): Promise<(LibraryExercise & { retired: boolean; videoPath: string | null }) | undefined> {
  const [row] = await db
    .select({ ...columns, retiredAt: exercise.retiredAt, videoPath: exercise.videoPath })
    .from(exercise)
    .where(eq(exercise.id, id));
  if (!row) return undefined;
  return { ...libraryExercise(row), retired: row.retiredAt !== null, videoPath: row.videoPath };
}

/** Adds an exercise, with its video when there is one; the database stamps who and when. */
export async function insertExercise(
  tx: DbOrTransaction,
  values: { name: string; defaultDose: string; video?: ExerciseVideo; by: string },
): Promise<string> {
  const [row] = await tx
    .insert(exercise)
    .values({
      name: values.name,
      defaultDose: values.defaultDose,
      videoPath: values.video?.path ?? null,
      videoType: values.video?.type ?? null,
      videoBytes: values.video?.bytes ?? null,
      createdBy: values.by,
    })
    .returning({ id: exercise.id });
  if (!row) throw new Error('The exercise was not added.');
  return row.id;
}

/** Retires an active exercise, naming its replacement when there is one; false when not active. */
export async function retireExercise(
  tx: DbOrTransaction,
  id: string,
  replacedBy?: string,
): Promise<boolean> {
  const done = await tx
    .update(exercise)
    .set({ retiredAt: sql`now()`, replacedBy: replacedBy ?? null })
    .where(and(eq(exercise.id, id), isNull(exercise.retiredAt)))
    .returning({ id: exercise.id });
  return done.length > 0;
}

/** The video of an exercise in the plan of the patient's own My plan link, inside their access. */
export async function myPlanExerciseVideo(
  db: DbOrTransaction,
  exerciseId: string,
): Promise<ExerciseVideo | undefined> {
  const [row] = await db.execute<{ video: ExerciseVideo | null }>(
    sql`select internal.my_plan_exercise_video(${exerciseId}::uuid) as video`,
  );
  return row?.video ?? undefined;
}
