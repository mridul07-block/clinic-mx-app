'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';
import { NotAllowedError, ReadOnlyError } from '../access/guard';
import { serviceContext } from '../access/staff-db';
import { clientIp } from '../auth/session';
import type { FeedbackQrState } from '../feedback/actions';
import { PatientLinkError } from '../patient-links/services';
import { showQuestionnaires, submitQuestionnaire } from './services';

/** A token as signing makes it (base64url); anything else goes nowhere. */
const tokenPattern = /^[A-Za-z0-9_-]{20,120}$/;

/**
 * Sends one filled questionnaire (OUT-02), then shows the link's page again: the next
 * questionnaire, or the thanks after the last.
 */
export async function sendQuestionnaireAction(form: FormData): Promise<void> {
  const token = form.get('token');
  if (typeof token !== 'string' || !tokenPattern.test(token)) redirect('/');
  await submitQuestionnaire(token, form, await clientIp());
  redirect(`/p/${token}`);
}

/** Show the questionnaire QR for an open episode whose plan has one to fill (OUT-02). */
export async function showQuestionnairesAction(
  _state: FeedbackQrState,
  form: FormData,
): Promise<FeedbackQrState> {
  const episodeId = form.get('episodeId');
  try {
    const shown = await showQuestionnaires(await serviceContext(), {
      episodeId: typeof episodeId === 'string' ? episodeId : '',
    });
    return { path: shown.path, expiresAt: shown.expiresAt.toISOString() };
  } catch (error) {
    if (error instanceof z.ZodError) return { error: error.issues[0]?.message ?? 'Try again.' };
    if (error instanceof PatientLinkError || error instanceof ReadOnlyError) {
      return { error: error.message };
    }
    if (error instanceof NotAllowedError) {
      return { error: 'Only those who check patients in at this centre show this.' };
    }
    throw error;
  }
}
