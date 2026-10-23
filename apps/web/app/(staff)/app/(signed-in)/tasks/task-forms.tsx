'use client';

import { useActionState } from 'react';
import {
  FormMessage,
  primaryButtonClass,
  secondaryButtonClass,
  TextAreaField,
} from '../../../../../components/forms';
import {
  closeTaskAction,
  takeTaskAction,
  type TaskFormState,
} from '../../../../../modules/tasks/actions';

const initialState: TaskFormState = {};

function Refusal({ state }: { state: TaskFormState }) {
  return state.error ? <FormMessage tone="danger">{state.error}</FormMessage> : null;
}

/** "Take it": the role task becomes yours and leaves everyone else's list (ALT-03). */
export function TakeForm({ taskId }: { taskId: string }) {
  const [state, action, pending] = useActionState(takeTaskAction, initialState);
  return (
    <form action={action} className="flex flex-col gap-2">
      <input type="hidden" name="taskId" value={taskId} />
      <Refusal state={state} />
      <button type="submit" disabled={pending} className={`${secondaryButtonClass} sm:w-auto`}>
        Take it
      </button>
    </form>
  );
}

/**
 * Close with a written decision; nothing closes without one (PRD M11). Folded until opened, so
 * the list stays a list and each card has one plain action; opens again after a refusal.
 */
export function CloseTaskForm({ taskId }: { taskId: string }) {
  const [state, action, pending] = useActionState(closeTaskAction, initialState);
  return (
    <details className="group" open={state.error ? true : undefined}>
      <summary
        className={`${secondaryButtonClass} cursor-pointer list-none sm:w-auto [&::-webkit-details-marker]:hidden`}
      >
        Close…
      </summary>
      <form action={action} className="mt-3 flex flex-col gap-2" noValidate>
        <input type="hidden" name="taskId" value={taskId} />
        <Refusal state={state} />
        <TextAreaField
          label="Decision"
          name="decision"
          maxLength={1000}
          helper="What was done or decided. It is kept with the task."
        />
        <button type="submit" disabled={pending} className={`${primaryButtonClass} sm:w-auto`}>
          Close with decision
        </button>
      </form>
    </details>
  );
}
