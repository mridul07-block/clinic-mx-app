import { and, eq, sql } from 'drizzle-orm';
import { exerciseTick } from './schema';
import type { DbOrTransaction } from './versioned';

/**
 * Home exercise ticks (PAT-02; docs/runbooks/my-plan.md). The patient ticks and unticks through
 * their My plan link (`internal.exercise_tick_subject`: the newest plan, today in IST); clinicians
 * read the adherence through `internal.session_adherence` and `internal.exercise_ticked_days`.
 */

/** What the patient's My plan link may tick; undefined for any other link. */
export interface ExerciseTickSubject {
  patientId: string;
  episodeId: string;
  planOfCareId: string;
  homeProgramme: { exercise: string; dose: string; note: string }[];
  /** Today, in IST. */
  today: string;
}

export async function exerciseTickSubject(
  db: DbOrTransaction,
): Promise<ExerciseTickSubject | undefined> {
  const [row] = await db.execute<{
    patient_id: string;
    episode_id: string;
    plan_of_care_id: string;
    home_programme: ExerciseTickSubject['homeProgramme'];
    today: string;
  }>(sql`select * from internal.exercise_tick_subject()`);
  if (!row) return undefined;
  return {
    patientId: row.patient_id,
    episodeId: row.episode_id,
    planOfCareId: row.plan_of_care_id,
    homeProgramme: row.home_programme,
    today: row.today,
  };
}

/** Ticks a row of the subject's plan for today; ticking it again changes nothing. */
export async function tickExercise(
  db: DbOrTransaction,
  values: { linkId: string; subject: ExerciseTickSubject; index: number; exercise: string },
): Promise<void> {
  await db
    .insert(exerciseTick)
    .values({
      patientId: values.subject.patientId,
      episodeId: values.subject.episodeId,
      planOfCareId: values.subject.planOfCareId,
      exerciseIndex: values.index,
      exercise: values.exercise,
      day: values.subject.today,
      patientLinkId: values.linkId,
    })
    .onConflictDoNothing();
}

/** Unticks a row of the subject's plan for today. */
export async function untickExercise(
  db: DbOrTransaction,
  values: { subject: ExerciseTickSubject; index: number },
): Promise<void> {
  await db
    .delete(exerciseTick)
    .where(
      and(
        eq(exerciseTick.planOfCareId, values.subject.planOfCareId),
        eq(exerciseTick.exerciseIndex, values.index),
        eq(exerciseTick.day, values.subject.today),
      ),
    );
}

/** A session's adherence, as `internal.session_adherence` works it out; null without a plan. */
export async function sessionAdherence(
  db: DbOrTransaction,
  sessionId: string,
): Promise<Record<string, unknown> | null> {
  const [row] = await db.execute<{ adherence: Record<string, unknown> | null }>(
    sql`select internal.session_adherence(${sessionId}::uuid) as adherence`,
  );
  return row?.adherence ?? null;
}

/**
 * The IST days from `from` to `to` with any exercise ticked, and the first day the patient could
 * tick (null before they had both a plan and a My plan link), for clinicians.
 */
export async function exerciseTickedDays(
  db: DbOrTransaction,
  episodeId: string,
  from: string,
  to: string,
): Promise<{ days: string[]; trackedFrom: string | null }> {
  const [row] = await db.execute<{ ticked: { days: string[]; trackedFrom: string | null } }>(
    sql`select internal.exercise_ticked_days(${episodeId}::uuid, ${from}::date, ${to}::date) as ticked`,
  );
  return row?.ticked ?? { days: [], trackedFrom: null };
}
