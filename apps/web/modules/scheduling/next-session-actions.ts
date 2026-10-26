'use server';

import { SlotRefusedError } from '@clinic-mx/db';
import { documentTime, seriesStartText } from '@clinic-mx/schemas';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { NotAllowedError, ReadOnlyError } from '../access/guard';
import { serviceContext } from '../access/staff-db';
import { bookNextSession, nextSessionTimes } from './next-session';
import { SchedulingError } from './services';

/** What the Next session panel shows after a post (SCH-12). */
export interface NextSessionFormState {
  error?: string;
  /** The date given back: the form resets after each post (React 19). */
  date?: string;
  /** The physio's free starts that day. */
  times?: { value: string; label: string }[];
  booked?: { number: string; when: string };
}

const text = (form: FormData, name: string) => {
  const value = form.get(name);
  return typeof value === 'string' ? value : '';
};

/** Refusals and bad input become messages; anything else is ours and is thrown. */
function failure(error: unknown): string {
  if (error instanceof z.ZodError) return error.issues[0]?.message ?? 'That could not be read.';
  if (
    error instanceof SchedulingError ||
    error instanceof SlotRefusedError ||
    error instanceof ReadOnlyError
  ) {
    return error.message;
  }
  if (error instanceof NotAllowedError) return 'You cannot book at this centre.';
  throw error;
}

/** "Show times" lists the physio's free starts on the date; "Book" books the one picked. */
export async function nextSessionAction(
  _state: NextSessionFormState,
  form: FormData,
): Promise<NextSessionFormState> {
  const appointmentId = text(form, 'appointmentId');
  const date = text(form, 'date');
  const context = await serviceContext();
  const show = async (error?: string): Promise<NextSessionFormState> => {
    try {
      const slots = await nextSessionTimes(context.actor, { appointmentId, date });
      return {
        date,
        error,
        times: slots.map((slot) => ({
          value: slot.startsAt.toISOString(),
          label: documentTime(slot.startsAt),
        })),
      };
    } catch (refused) {
      return { date, error: error ?? failure(refused) };
    }
  };
  if (text(form, 'intent') !== 'book') return show();
  const startsAt = text(form, 'startsAt');
  if (!startsAt) return show('Pick a time.');
  try {
    const booked = await bookNextSession(context, { appointmentId, startsAt });
    revalidatePath(['/app/sessions', appointmentId].join('/'));
    return { booked: { number: booked.number, when: seriesStartText(booked.startsAt) } };
  } catch (error) {
    return show(failure(error));
  }
}
