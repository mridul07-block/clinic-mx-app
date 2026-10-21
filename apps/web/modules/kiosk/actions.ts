'use server';

import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { appDb } from '../../lib/db';
import { KIOSK_COOKIE, sessionCookieOptions } from '../../lib/session-cookies';
import { NotAllowedError, ReadOnlyError } from '../access/guard';
import { serviceContext } from '../access/staff-db';
import { endSession } from '../auth/auth-support';
import { patientLinkIdFromToken } from '../patient-links/services';
import { kioskBrowser } from './device';
import { KioskError, resetKiosk, setUpKiosk, stopKiosk } from './services';

/** What a kiosk tablets form shows after a post (IAM-10). */
export interface KioskFormState {
  error?: string;
  /** Messages by field: centreId, name. */
  fieldErrors?: Record<string, string>;
  /** What was typed, given back with an error so the form keeps it. */
  values?: Record<string, string>;
}

const PAGE = '/app/kiosk-tablets';

const text = (form: FormData, name: string) => {
  const value = form.get(name);
  return typeof value === 'string' ? value : '';
};

/** Refusals and bad input become messages; anything else is ours and is thrown. */
function failure(error: unknown): KioskFormState {
  if (error instanceof z.ZodError) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of error.issues) {
      const field = String(issue.path.at(-1) ?? 'form');
      fieldErrors[field] ??= issue.message;
    }
    return { error: 'Check the highlighted fields.', fieldErrors };
  }
  if (error instanceof KioskError || error instanceof ReadOnlyError) {
    return { error: error.message };
  }
  if (error instanceof NotAllowedError) {
    return { error: 'You do not have access to kiosk tablets in that centre.' };
  }
  throw error;
}

/**
 * Sets this browser up as a centre's kiosk: the staff member is signed out (logged), the tablet's
 * token goes in its cookie, and it opens the welcome screen. From then on it shows only patient
 * pages.
 */
export async function setUpKioskAction(
  _state: KioskFormState,
  form: FormData,
): Promise<KioskFormState> {
  const values = { centreId: text(form, 'centreId'), name: text(form, 'name') };
  let token: string;
  try {
    ({ token } = await setUpKiosk(await serviceContext(), values));
  } catch (error) {
    return { ...failure(error), values };
  }
  await endSession();
  (await cookies()).set(KIOSK_COOKIE, token, sessionCookieOptions);
  redirect('/kiosk');
}

export async function stopKioskAction(
  _state: KioskFormState,
  form: FormData,
): Promise<KioskFormState> {
  try {
    await stopKiosk(await serviceContext(), { kioskId: text(form, 'kioskId') });
  } catch (error) {
    return failure(error);
  }
  revalidatePath(PAGE);
  redirect(`${PAGE}?done=stopped`);
}

/**
 * The tablet goes back to its welcome screen (after a submit or when idle): the form it showed is
 * taken off it. Only this browser's own tablet, and only the form on it now.
 */
export async function resetKioskAction(token: string): Promise<void> {
  const browser = await kioskBrowser();
  const linkId = patientLinkIdFromToken(token);
  if (browser.status === 'active' && linkId) {
    await resetKiosk(appDb(), { kioskId: browser.device.id, linkId });
  }
}
