'use server';

import { redirect } from 'next/navigation';
import { clientIp } from '../auth/session';
import { reviewHealthFormDetails, saveHealthFormScreen, submitHealthForm } from './services';

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
  // Report photos on History (INT-05), already shrunk on the phone when scripts run.
  const files = form.getAll('reports').filter((value): value is File => value instanceof File);
  for (const key of new Set(form.keys())) {
    if (key === 'token' || key === 'screen' || key === 'reports' || key.startsWith('$')) continue;
    const values = form.getAll(key).filter((value): value is string => typeof value === 'string');
    posted[key] = values.length === 1 ? (values[0] ?? '') : values;
  }
  const page = `/p/${token}`;
  const result = await saveHealthFormScreen(token, screen, posted, {
    ip: await clientIp(),
    files,
  });
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

/**
 * Check and submit (INT-05): submits the form, then the link's page thanks the patient; with
 * answers still needed, the screen to carry on at.
 */
export async function submitAction(form: FormData): Promise<void> {
  const token = form.get('token');
  if (typeof token !== 'string' || !tokenPattern.test(token)) redirect('/');
  const page = `/p/${token}`;
  const result = await submitHealthForm(token, await clientIp());
  if (result.status === 'elsewhere') {
    redirect(`${page}?screen=${encodeURIComponent(result.resume)}`);
  }
  redirect(page);
}

/**
 * "Has anything changed?" (INT-08): No changes or Something changed, then the screen to carry on
 * at. A plain form post, so it works without scripts.
 */
export async function reviewDetailsAction(form: FormData): Promise<void> {
  const token = form.get('token');
  const changed = form.get('changed');
  if (typeof token !== 'string' || !tokenPattern.test(token)) redirect('/');
  if (changed !== 'yes' && changed !== 'no') redirect(`/p/${token}`);
  const page = `/p/${token}`;
  const result = await reviewHealthFormDetails(token, changed === 'yes', await clientIp());
  if (result.status === 'saved') redirect(`${page}?screen=${encodeURIComponent(result.next)}`);
  if (result.status === 'elsewhere') {
    redirect(`${page}?screen=${encodeURIComponent(result.resume)}`);
  }
  redirect(page);
}
