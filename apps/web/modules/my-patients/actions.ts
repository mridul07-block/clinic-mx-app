'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { NotAllowedError, ReadOnlyError } from '../access/guard';
import { serviceContext } from '../access/staff-db';
import { SchedulingError } from '../scheduling/services';
import { startVisit } from './services';

/** What a Start button shows after a post (CLN-01). */
export interface StartVisitState {
  error?: string;
}

const text = (form: FormData, name: string) => {
  const value = form.get(name);
  return typeof value === 'string' ? value : '';
};

/**
 * Starts the visit: a consultation opens its screen (CLN-02), a treatment session its session
 * screen (SES-02), a review the episode's Review and discharge screen (OUT-07); other visits show
 * In progress on the list. Refusals become messages.
 */
export async function startVisitAction(
  _state: StartVisitState,
  form: FormData,
): Promise<StartVisitState> {
  let consultationId: string | undefined;
  let sessionAppointmentId: string | undefined;
  let reviewEpisodeId: string | undefined;
  try {
    ({ consultationId, sessionAppointmentId, reviewEpisodeId } = await startVisit(
      await serviceContext(),
      {
        appointmentId: text(form, 'appointmentId'),
      },
    ));
  } catch (error) {
    if (error instanceof z.ZodError) {
      return { error: error.issues[0]?.message ?? 'That could not be read.' };
    }
    if (error instanceof SchedulingError || error instanceof ReadOnlyError) {
      return { error: error.message };
    }
    if (error instanceof NotAllowedError) return { error: 'You cannot start this visit.' };
    throw error;
  }
  revalidatePath('/app/my-patients');
  if (consultationId) redirect(`/app/consultations/${consultationId}`);
  if (sessionAppointmentId) redirect(`/app/sessions/${sessionAppointmentId}`);
  if (reviewEpisodeId) redirect(`/app/episodes/${reviewEpisodeId}/review`);
  return {};
}
