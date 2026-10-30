'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { NotAllowedError, ReadOnlyError } from '../access/guard';
import { serviceContext } from '../access/staff-db';
import { clientIp } from '../auth/session';
import { signatureStore } from '../intake/signature-store';
import { PatientLinkError } from '../patient-links/services';
import { openPartBOnTablet, savePartB, showPartBConsent } from './part-b';

/** What the Part B page shows after a post that needs answers (BIL-03). */
export interface PartBFormState {
  errors?: Record<string, string>;
  /** What was posted, given back so the page keeps it. */
  values?: Record<string, string | string[]>;
  /** Counts posts, so the fields start again from `values` after each one. */
  attempt?: number;
}

/** A token as signing makes it (base64url); anything else goes nowhere. */
const tokenPattern = /^[A-Za-z0-9_-]{20,120}$/;

/**
 * "Done" on Part B: records the decisions, then the link's page thanks the patient (and says the
 * desk will speak to them about anything declined); answers missing, the same page with messages.
 */
export async function savePartBAction(
  state: PartBFormState,
  form: FormData,
): Promise<PartBFormState> {
  const token = form.get('token');
  if (typeof token !== 'string' || !tokenPattern.test(token)) redirect('/');
  const posted: Record<string, string | string[]> = {};
  for (const key of new Set(form.keys())) {
    if (key === 'token' || key.startsWith('$')) continue;
    const values = form.getAll(key).filter((value): value is string => typeof value === 'string');
    posted[key] = values.length === 1 ? (values[0] ?? '') : values;
  }
  const page = `/p/${token}`;
  let result: Awaited<ReturnType<typeof savePartB>>;
  try {
    result = await savePartB(token, posted, { ip: await clientIp(), store: signatureStore() });
  } catch (error) {
    // Sent twice at once (the phone and the tablet): the link's page says it is done.
    const code = (error as { cause?: { code?: string } }).cause?.code;
    if (error instanceof PatientLinkError || code === '42501') redirect(page);
    throw error;
  }
  if (result.status === 'invalid') {
    return { errors: result.errors, values: posted, attempt: (state.attempt ?? 0) + 1 };
  }
  if (result.status === 'guardian_needed') redirect(`${page}?guardian=needed`);
  if (result.status === 'saved' && result.declined.length > 0) redirect(`${page}?declined=1`);
  redirect(page);
}

/** What the desk's Part B QR shows after a post (BIL-03). */
export interface PartBQrState {
  error?: string;
  path?: string;
  expiresAt?: string;
}

const field = (form: FormData, name: string) => {
  const value = form.get(name);
  return typeof value === 'string' ? value : '';
};

/** Refusals in words; anything else is ours and is thrown. */
function refusal(error: unknown): string {
  if (error instanceof z.ZodError) return error.issues[0]?.message ?? 'Try again.';
  if (error instanceof PatientLinkError || error instanceof ReadOnlyError) return error.message;
  if (error instanceof NotAllowedError) {
    return 'Only those who check patients in at this centre ask for consent.';
  }
  throw error;
}

/** "Show Part B consent QR" on the plan and payment sheet. */
export async function showPartBConsentAction(
  _state: PartBQrState,
  form: FormData,
): Promise<PartBQrState> {
  try {
    const shown = await showPartBConsent(await serviceContext(), {
      episodeId: field(form, 'episodeId'),
    });
    return { path: shown.path, expiresAt: shown.expiresAt.toISOString() };
  } catch (error) {
    return { error: refusal(error) };
  }
}

/** What Open on tablet says after a post. */
export interface PartBTabletState {
  error?: string;
  done?: string;
}

/** "Open on tablet" for Part B: the consent page goes to the chosen kiosk tablet. */
export async function openPartBOnTabletAction(
  _state: PartBTabletState,
  form: FormData,
): Promise<PartBTabletState> {
  try {
    const { tabletName } = await openPartBOnTablet(await serviceContext(), {
      episodeId: field(form, 'episodeId'),
      kioskId: field(form, 'kioskId'),
    });
    revalidatePath(['/app/plans', field(form, 'episodeId')].join('/'));
    return { done: `Opening on ${tabletName}.` };
  } catch (error) {
    return { error: refusal(error) };
  }
}
