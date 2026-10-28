'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { NotAllowedError, ReadOnlyError } from '../access/guard';
import { serviceContext } from '../access/staff-db';
import { clientIp } from '../auth/session';
import { showMyPlan, tickMyPlanExercise } from './my-plan';
import { PatientLinkError } from './services';

/** What the My plan QR shows after a post (PAT-01): the page to open, or why not. */
export interface MyPlanQrState {
  error?: string;
  path?: string;
  expiresAt?: string;
}

/** Show My plan QR: the episode's working My plan link, issued when it has none. */
export async function showMyPlanAction(
  _state: MyPlanQrState,
  form: FormData,
): Promise<MyPlanQrState> {
  const episodeId = form.get('episodeId');
  try {
    const shown = await showMyPlan(await serviceContext(), {
      episodeId: typeof episodeId === 'string' ? episodeId : '',
    });
    return { path: shown.path, expiresAt: shown.expiresAt.toISOString() };
  } catch (error) {
    if (error instanceof z.ZodError) return { error: error.issues[0]?.message ?? 'Try again.' };
    if (error instanceof PatientLinkError || error instanceof ReadOnlyError) {
      return { error: error.message };
    }
    if (error instanceof NotAllowedError) {
      return { error: 'Only those who check patients in at this centre show My plan.' };
    }
    throw error;
  }
}

/** A token as signing makes it (base64url); anything else goes nowhere. */
const tokenPattern = /^[A-Za-z0-9_-]{20,120}$/;

/**
 * Ticks or unticks an exercise on My plan (PAT-02), then shows the page again at the exercises; a
 * plan changed under the page says so there. A plain form post, so it works without scripts.
 */
export async function tickExerciseAction(form: FormData): Promise<void> {
  const token = form.get('token');
  if (typeof token !== 'string' || !tokenPattern.test(token)) redirect('/');
  const result = await tickMyPlanExercise(
    token,
    { index: form.get('index'), exercise: form.get('exercise'), done: form.get('done') },
    await clientIp(),
  );
  // The same page again: drop the router's copy so it shows the tick.
  revalidatePath(`/p/${token}`);
  redirect(`/p/${token}${result === 'changed' ? '?changed=1' : ''}#my-plan-exercises`);
}
