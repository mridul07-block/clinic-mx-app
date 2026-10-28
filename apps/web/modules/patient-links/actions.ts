'use server';

import { z } from 'zod';
import { NotAllowedError, ReadOnlyError } from '../access/guard';
import { serviceContext } from '../access/staff-db';
import { showMyPlan } from './my-plan';
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
