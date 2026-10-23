'use server';

import { redirect } from 'next/navigation';
import { clientIp } from '../auth/session';
import { saveHealthFormScreen } from './services';

/** What a health form screen shows after a post that needs answers (INT-04). */
export interface HealthFormState {
  errors?: Record<string, string>;
  /** What was posted, given back so the screen keeps it. */
  values?: Record<string, string | string[]>;
  /** Counts posts, so the screen's fields start again from `values` after each one. */
  attempt?: number;
}

/** A token as signing makes it (base64url); anything else goes nowhere. */
const tokenPattern = /^[A-Za-z0-9_-]{20,120}$/;

/**
 * Saves a health form screen, then opens the next one; with answers missing, the same screen
 * with its messages. A closed visit or a link no longer working goes back to the link's page,
 * which says why.
 */
export async function saveScreenAction(
  state: HealthFormState,
  form: FormData,
): Promise<HealthFormState> {
  const token = form.get('token');
  const screen = form.get('screen');
  if (typeof token !== 'string' || !tokenPattern.test(token) || typeof screen !== 'string') {
    redirect('/');
  }
  const posted: Record<string, string | string[]> = {};
  for (const key of new Set(form.keys())) {
    if (key === 'token' || key === 'screen' || key.startsWith('$')) continue;
    const values = form.getAll(key).filter((value): value is string => typeof value === 'string');
    posted[key] = values.length === 1 ? (values[0] ?? '') : values;
  }
  const page = `/p/${token}`;
  const result = await saveHealthFormScreen(token, screen, posted, await clientIp());
  if (result.status === 'invalid') {
    return { errors: result.errors, values: posted, attempt: (state.attempt ?? 0) + 1 };
  }
  if (result.status === 'saved') redirect(`${page}?screen=${encodeURIComponent(result.next)}`);
  // A Part A statement declined (INT-06): the consent screen now asks for reception.
  if (result.status === 'declined') redirect(`${page}?screen=${encodeURIComponent(screen)}`);
  // Under the adult age with no guardian on file (INT-07): reception adds one first.
  if (result.status === 'guardian_needed') {
    redirect(`${page}?screen=${encodeURIComponent(screen)}&guardian=needed`);
  }
  if (result.status === 'elsewhere') {
    redirect(`${page}?screen=${encodeURIComponent(result.resume)}`);
  }
  redirect(page);
}
