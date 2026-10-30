'use client';

import { useActionState, useId } from 'react';
import {
  FormMessage,
  TextField,
  dangerButtonClass,
  primaryButtonClass,
  secondaryButtonClass,
} from '../../../../../components/forms';
import {
  addExerciseAction,
  replaceExerciseAction,
  retireExerciseAction,
  type ExerciseFormState,
} from '../../../../../modules/exercises/actions';

const initialState: ExerciseFormState = {};
const fileClass =
  'text-ink file:mr-3 file:h-row file:rounded-control file:border file:border-line-control file:bg-surface file:px-3 file:text-ink';

/** The video field: a short MP4 or WebM clip, at most `maxMegabytes`. */
function VideoField({ maxMegabytes, label }: { maxMegabytes: number; label: string }) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="font-medium text-ink">
        {label}
      </label>
      <p id={`${id}-hint`} className="text-sm text-ink-muted">
        MP4 or WebM, at most {maxMegabytes} MB: a short clip, filmed for phones.
      </p>
      <input
        id={id}
        type="file"
        name="video"
        accept="video/mp4,video/webm"
        aria-describedby={`${id}-hint`}
        className={fileClass}
      />
    </div>
  );
}

/** "Add to library" (SET-07): the name, the default dose and the video when there is one. */
export function AddExerciseForm({ maxMegabytes }: { maxMegabytes: number }) {
  const [state, action, pending] = useActionState(addExerciseAction, initialState);
  return (
    <form
      key={state.attempt ?? 0}
      action={action}
      className="flex flex-col gap-4"
      data-testid="add-exercise"
    >
      {state.error ? <FormMessage tone="danger">{state.error}</FormMessage> : null}
      {state.done ? <FormMessage tone="info">{state.done}</FormMessage> : null}
      <TextField
        label="Exercise"
        name="name"
        defaultValue={state.values?.name}
        maxLength={120}
        required
      />
      <TextField
        label="Default dose"
        name="defaultDose"
        defaultValue={state.values?.defaultDose}
        helper="As the plan shows it, as “3 × 10, daily”."
        maxLength={120}
        required
      />
      <VideoField maxMegabytes={maxMegabytes} label="Video (optional)" />
      <button
        type="submit"
        disabled={pending}
        className={`${primaryButtonClass} md:w-auto md:self-start`}
      >
        {pending ? 'Adding…' : 'Add to library'}
      </button>
    </form>
  );
}

/**
 * Change an exercise: saved as a new version, the old one retired, so plans written with it keep
 * it; without a new video it keeps its video. Or remove it from the library.
 */
export function ChangeExerciseForms({
  exerciseId,
  name,
  defaultDose,
  maxMegabytes,
}: {
  exerciseId: string;
  name: string;
  defaultDose: string;
  maxMegabytes: number;
}) {
  const [state, action, pending] = useActionState(replaceExerciseAction, initialState);
  const [removed, remove, removing] = useActionState(retireExerciseAction, initialState);
  return (
    <div className="flex flex-col gap-4">
      <form action={action} className="flex flex-col gap-4">
        <input type="hidden" name="exerciseId" value={exerciseId} />
        {state.error ? <FormMessage tone="danger">{state.error}</FormMessage> : null}
        <TextField
          label="Exercise"
          name="name"
          defaultValue={state.values?.name ?? name}
          maxLength={120}
          required
        />
        <TextField
          label="Default dose"
          name="defaultDose"
          defaultValue={state.values?.defaultDose ?? defaultDose}
          maxLength={120}
          required
        />
        <VideoField maxMegabytes={maxMegabytes} label="New video (optional)" />
        <p className="text-sm text-ink-muted">
          Saved as a new version. Plans already written keep the one they used.
        </p>
        <button
          type="submit"
          disabled={pending}
          className={`${secondaryButtonClass} md:w-auto md:self-start`}
        >
          {pending ? 'Saving…' : 'Save as a new version'}
        </button>
      </form>
      <form action={remove} className="flex flex-col gap-2">
        <input type="hidden" name="exerciseId" value={exerciseId} />
        {removed.error ? <FormMessage tone="danger">{removed.error}</FormMessage> : null}
        <button
          type="submit"
          disabled={removing}
          className={`${dangerButtonClass} md:w-auto md:self-start`}
        >
          Remove from library
        </button>
      </form>
    </div>
  );
}
