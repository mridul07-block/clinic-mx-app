'use server';

import { twoStepCodeSchema, twoStepSetupSchema } from '@clinic-mx/schemas';
import { redirect } from 'next/navigation';
import {
  authClient,
  authMessage,
  checkCode,
  firstIssue,
  isRefusal,
  logAccess,
  messages,
  type AuthFormState,
} from './auth-support';
import { clear, count, limited, tryAgainIn } from '../rate-limits/limits';
import { safeNextPath } from './next-path';
import { signInState } from './session';

/**
 * Two step verification (IAM-02, TAD section 5): a code from an authenticator app (TOTP) after
 * the password, required for every role except Front Desk. Only this server calls Supabase Auth.
 */

/** Finishes signing in with a code from the authenticator app. */
export async function verifyTwoStep(_state: AuthFormState, form: FormData): Promise<AuthFormState> {
  const parsed = twoStepCodeSchema.safeParse({ code: form.get('code') });
  if (!parsed.success) return { error: firstIssue(parsed.error) };

  const state = await signInState();
  if (!state) redirect('/app/sign-in');
  if (state.stage === 'complete') redirect(safeNextPath(form.get('next')));
  if (state.stage === 'setup') redirect('/app/two-step/setup');

  // IAM-11: wrong codes are limited per login.
  const over = await limited('two_step_per_person', state.staff.id);
  if (over.limited) return { error: tryAgainIn(over) };
  const supabase = await authClient();
  if (!supabase) return { error: messages.unavailable };
  const { data: factors, error: listError } = await supabase.auth.mfa.listFactors();
  const [factor] = factors?.totp ?? [];
  if (listError || !factor) return { error: messages.unavailable };
  const { error } = await checkCode(supabase, factor.id, parsed.data.code);
  if (error) {
    if (isRefusal(error)) await count('two_step_per_person', state.staff.id);
    return { error: authMessage(error, messages.wrongCode) };
  }
  await clear('two_step_per_person', state.staff.id);
  await logAccess(state.staff, 'sign_in');
  redirect(safeNextPath(form.get('next')));
}

/**
 * Turns two step verification on with the first code from the newly added authenticator app.
 * Finishes the sign in of a role that requires it; a Front Desk member who chose it from the
 * account page returns there.
 */
export async function finishTwoStepSetup(
  _state: AuthFormState,
  form: FormData,
): Promise<AuthFormState> {
  const parsed = twoStepSetupSchema.safeParse({
    factorId: form.get('factorId'),
    code: form.get('code'),
  });
  if (!parsed.success) return { error: firstIssue(parsed.error) };

  const state = await signInState();
  if (!state) redirect('/app/sign-in');
  if (state.twoStepOn) redirect(state.stage === 'verify' ? '/app/two-step' : '/app/account');

  const over = await limited('two_step_per_person', state.staff.id);
  if (over.limited) return { error: tryAgainIn(over) };
  const supabase = await authClient();
  if (!supabase) return { error: messages.unavailable };
  const { error } = await checkCode(supabase, parsed.data.factorId, parsed.data.code);
  if (error) {
    if (isRefusal(error)) await count('two_step_per_person', state.staff.id);
    return { error: authMessage(error, messages.wrongCode) };
  }
  await clear('two_step_per_person', state.staff.id);

  await logAccess(state.staff, 'two_step_on');
  if (state.stage === 'setup') {
    await logAccess(state.staff, 'sign_in');
    redirect(safeNextPath(form.get('next')));
  }
  redirect('/app/account?two-step=on');
}
