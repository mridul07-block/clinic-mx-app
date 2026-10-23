'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { NotAllowedError, ReadOnlyError } from '../access/guard';
import { serviceContext } from '../access/staff-db';
import { closeTask, takeTask, TaskError } from './services';

/** What a task form shows after a post (ALT-03). */
export interface TaskFormState {
  error?: string;
  done?: boolean;
}

const text = (form: FormData, name: string) => {
  const value = form.get(name);
  return typeof value === 'string' ? value : '';
};

/** Refusals become messages; anything else is ours and is thrown. */
function failure(error: unknown): TaskFormState {
  if (error instanceof z.ZodError) {
    return { error: error.issues[0]?.message ?? 'That could not be read.' };
  }
  if (error instanceof TaskError || error instanceof ReadOnlyError) {
    return { error: error.message };
  }
  if (error instanceof NotAllowedError) {
    return { error: 'This task is not yours to act on.' };
  }
  throw error;
}

/** The inbox and the Home count both change. */
function refresh(): TaskFormState {
  revalidatePath('/app', 'layout');
  return { done: true };
}

export async function takeTaskAction(
  _state: TaskFormState,
  form: FormData,
): Promise<TaskFormState> {
  try {
    await takeTask(await serviceContext(), { taskId: text(form, 'taskId') });
  } catch (error) {
    return failure(error);
  }
  return refresh();
}

export async function closeTaskAction(
  _state: TaskFormState,
  form: FormData,
): Promise<TaskFormState> {
  try {
    await closeTask(await serviceContext(), {
      taskId: text(form, 'taskId'),
      decision: text(form, 'decision'),
    });
  } catch (error) {
    return failure(error);
  }
  return refresh();
}
