import type { Metadata } from 'next';
import Link from 'next/link';
import { requirePermission } from '../../../../../modules/access/require-permission';
import { loadLibrary } from '../../../../../modules/exercises/services';
import { getSetting } from '../../../../../modules/settings/settings';
import { AddExerciseForm, ChangeExerciseForms } from './exercise-forms';

export const metadata: Metadata = { title: 'Exercise library · Clinic Mx' };

const disclosure =
  'cursor-pointer self-start text-sm text-accent underline underline-offset-2 pointer-coarse:py-3';

// The exercise library (SET-07; PRD M7 and M13; TAD `kb_exercise`): the clinic's exercises with a
// default dose and a short video, kept by the Super Admin. Clinicians pick them for the home
// programme; patients watch the videos on My plan.
export default async function ExercisesPage() {
  const staff = await requirePermission('exercises.manage');
  const [exercises, maxMegabytes] = await Promise.all([
    loadLibrary(staff),
    getSetting('exercises.video_max_mb'),
  ]);
  return (
    <main className="flex w-full max-w-3xl flex-col gap-6 px-4 py-6">
      <div className="flex flex-col gap-1.5">
        <Link href="/app" className="text-sm text-ink-muted underline underline-offset-2">
          Home
        </Link>
        <h1 className="text-title font-semibold">Exercise library</h1>
        <p className="text-ink-secondary">
          The clinic’s exercises, each with its default dose and a short video. Clinicians add them
          to a patient’s home programme; the patient watches the video on My plan.
        </p>
      </div>
      <section
        aria-labelledby="add-exercise"
        className="flex flex-col gap-3 rounded-panel border border-line bg-surface p-4"
      >
        <h2 id="add-exercise" className="font-semibold text-ink">
          Add an exercise
        </h2>
        <AddExerciseForm maxMegabytes={maxMegabytes} />
      </section>
      {exercises.length ? (
        <ul className="flex flex-col gap-3" data-testid="exercises">
          {exercises.map((exercise) => (
            <li
              key={exercise.id}
              className="flex flex-col gap-2 rounded-panel border border-line bg-surface p-4"
              data-testid="exercise"
              data-exercise={exercise.id}
            >
              <p className="font-semibold text-ink">{exercise.name}</p>
              <p className="text-ink-secondary">{exercise.defaultDose}</p>
              {exercise.video ? (
                <video
                  controls
                  playsInline
                  preload="none"
                  src={['/app/exercises', exercise.id, 'video'].join('/')}
                  aria-label={`Video: ${exercise.name}`}
                  className="w-full max-w-sm rounded-control bg-surface-sunken"
                />
              ) : (
                <p className="text-sm text-ink-muted">No video yet.</p>
              )}
              <details className="flex flex-col gap-3">
                <summary className={disclosure}>Change or remove</summary>
                <div className="pt-3">
                  <ChangeExerciseForms
                    exerciseId={exercise.id}
                    name={exercise.name}
                    defaultDose={exercise.defaultDose}
                    maxMegabytes={maxMegabytes}
                  />
                </div>
              </details>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-ink-muted">No exercises yet.</p>
      )}
    </main>
  );
}
