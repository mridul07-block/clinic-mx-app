'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';
import { NotAllowedError, ReadOnlyError } from '../access/guard';
import { serviceContext } from '../access/staff-db';
import { clientIp } from '../auth/session';
import { PatientLinkError } from '../patient-links/services';
import {
  showDischargeFeedback,
  showFeedback,
  showFirstTreatmentCheck,
  showFollowUpCheck,
  submitFeedback,
  submitFirstTreatmentCheck,
  submitFollowUpCheck,
  type FeedbackQr,
} from './services';

/** What the feedback form shows after a post that needs answers (PAT-04). */
export interface FeedbackFormState {
  errors?: Record<string, string>;
  /** What was posted, given back so the form keeps it. */
  values?: Record<string, string>;
  /** Counts posts, so the fields start again from `values` after each one. */
  attempt?: number;
}

/** A token as signing makes it (base64url); anything else goes nowhere. */
const tokenPattern = /^[A-Za-z0-9_-]{20,120}$/;

/**
 * Sends the patient's answers, then shows the link's page, which thanks them; with an answer
 * missing, the form again with its messages. A plain form post, so it works without scripts.
 */
export async function sendFeedbackAction(
  state: FeedbackFormState,
  form: FormData,
): Promise<FeedbackFormState> {
  const token = form.get('token');
  if (typeof token !== 'string' || !tokenPattern.test(token)) redirect('/');
  const result = await submitFeedback(token, form, await clientIp());
  if (result.status === 'invalid') {
    return { errors: result.errors, values: result.values, attempt: (state.attempt ?? 0) + 1 };
  }
  redirect(`/p/${token}`);
}

/**
 * Sends the patient's tap on the day after first treatment check (PAT-05), then shows the link's
 * page, which thanks them. A plain form post, so it works without scripts.
 */
export async function sendFirstTreatmentCheckAction(form: FormData): Promise<void> {
  const token = form.get('token');
  if (typeof token !== 'string' || !tokenPattern.test(token)) redirect('/');
  await submitFirstTreatmentCheck(token, form, await clientIp());
  redirect(`/p/${token}`);
}

/** Sends the patient's tap on a follow up after discharge (PAT-10), then thanks them. */
export async function sendFollowUpCheckAction(form: FormData): Promise<void> {
  const token = form.get('token');
  if (typeof token !== 'string' || !tokenPattern.test(token)) redirect('/');
  await submitFollowUpCheck(token, form, await clientIp());
  redirect(`/p/${token}`);
}

/** What the "Rate your visit" QR shows after a post: the page to open, received, or why not. */
export interface FeedbackQrState {
  error?: string;
  received?: boolean;
  path?: string;
  expiresAt?: string;
}

/** Show the "Rate your visit" QR for the episode's newest signed consultation. */
export async function showFeedbackAction(
  _state: FeedbackQrState,
  form: FormData,
): Promise<FeedbackQrState> {
  return showing(form, showFeedback);
}

/** Show the day after first treatment check QR for the episode's signed session 1 (PAT-05). */
export async function showFirstTreatmentCheckAction(
  _state: FeedbackQrState,
  form: FormData,
): Promise<FeedbackQrState> {
  return showing(form, showFirstTreatmentCheck);
}

/** Show the follow up QR for a discharged episode with a follow up due (PAT-10). */
export async function showFollowUpCheckAction(
  _state: FeedbackQrState,
  form: FormData,
): Promise<FeedbackQrState> {
  return showing(form, showFollowUpCheck);
}

/** Show the discharge feedback QR for a discharged episode (PAT-07). */
export async function showDischargeFeedbackAction(
  _state: FeedbackQrState,
  form: FormData,
): Promise<FeedbackQrState> {
  return showing(form, showDischargeFeedback);
}

async function showing(form: FormData, show: typeof showFeedback): Promise<FeedbackQrState> {
  const episodeId = form.get('episodeId');
  try {
    const shown: FeedbackQr = await show(await serviceContext(), {
      episodeId: typeof episodeId === 'string' ? episodeId : '',
    });
    if (shown.received) return { received: true };
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
