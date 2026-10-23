'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';
import { NotAllowedError, ReadOnlyError } from '../access/guard';
import { serviceContext } from '../access/staff-db';
import { SchedulingError } from '../scheduling/services';
import { todayHref } from './links';
import { checkIn, undoCheckIn } from './services';

/** What a Today board button shows after a post (INT-01). */
export interface TodayFormState {
  error?: string;
}

const text = (form: FormData, name: string) => {
  const value = form.get(name);
  return typeof value === 'string' ? value : '';
};

/** Refusals become messages; anything else is ours and is thrown. */
function failure(error: unknown): TodayFormState {
  if (error instanceof z.ZodError) return { error: 'That appointment could not be read.' };
  if (error instanceof SchedulingError || error instanceof ReadOnlyError) {
    return { error: error.message };
  }
  if (error instanceof NotAllowedError) return { error: 'You cannot check in at that centre.' };
  throw error;
}

/** Back to the board as it was: its centre and chip. */
const back = (form: FormData) =>
  todayHref({ centreId: text(form, 'centreId'), show: text(form, 'show') || undefined });

/** Checks the patient in (INT-01); then the board again. */
export async function checkInAction(
  _state: TodayFormState,
  form: FormData,
): Promise<TodayFormState> {
  try {
    await checkIn(await serviceContext(), { appointmentId: text(form, 'appointmentId') });
  } catch (error) {
    return failure(error);
  }
  redirect(back(form));
}

/** Undoes a check in made by mistake (INT-01); then the board again. */
export async function undoCheckInAction(
  _state: TodayFormState,
  form: FormData,
): Promise<TodayFormState> {
  try {
    await undoCheckIn(await serviceContext(), { appointmentId: text(form, 'appointmentId') });
  } catch (error) {
    return failure(error);
  }
  redirect(back(form));
}
