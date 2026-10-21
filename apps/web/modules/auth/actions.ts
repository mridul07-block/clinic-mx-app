'use server';

import { staffForSignIn } from '@clinic-mx/db';
import {
  newPasswordSchema,
  passwordResetRequestSchema,
  signInSchema,
  twoStepCodeSchema,
} from '@clinic-mx/schemas';
import type { JwtPayload } from '@supabase/supabase-js';
import { redirect } from 'next/navigation';
import { appDb } from '../../lib/db';
import {
  authClient,
  authMessage,
  checkCode,
  firstIssue,
  logAccess,
  messages,
  nextParam,
  type AuthFormState,
} from './auth-support';
import { safeNextPath } from './next-path';
import { signInState } from './session';
import { signInStage, stagePath } from './two-step';

export type { AuthFormState } from './auth-support';

/**
 * Staff sign in, sign out and password reset (IAM-01). Forms post here; only this server calls
 * Supabase Auth (rule 9). Messages never say whether an email has an account. Two step
 * verification (IAM-02) continues in two-step-actions.ts.
 */

const typedEmail = (form: FormData) => {
  const value = form.get('email');
  return typeof value === 'string' ? value : '';
};

export async function signIn(_state: AuthFormState, form: FormData): Promise<AuthFormState> {
  const email = typedEmail(form);
  const parsed = signInSchema.safeParse({ email, password: form.get('password') });
  if (!parsed.success) return { error: firstIssue(parsed.error), email };

  const supabase = await authClient();
  if (!supabase) return { error: messages.unavailable, email };
  const { data, error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) return { error: authMessage(error, messages.signInFailed), email };

  // A login whose staff member is deactivated or past their end date gets no session.
  const staff = await staffForSignIn(appDb(), data.user.id);
  if (!staff) {
    await supabase.auth.signOut({ scope: 'local' });
    return { error: messages.signInFailed, email };
  }

  // The user comes from Supabase Auth's answer, so its authenticator apps can be trusted.
  const hasAuthenticator = (data.user.factors ?? []).some(
    (factor) => factor.factor_type === 'totp' && factor.status === 'verified',
  );
  const stage = signInStage({ role: staff.role, level: 'aal1', hasAuthenticator });
  const next = safeNextPath(form.get('next'));
  if (stage !== 'complete') redirect(`${stagePath[stage]}${nextParam(next)}`);
  await logAccess(staff, 'sign_in');
  redirect(next);
}

export async function requestPasswordReset(
  _state: AuthFormState,
  form: FormData,
): Promise<AuthFormState> {
  const email = typedEmail(form);
  const parsed = passwordResetRequestSchema.safeParse({ email });
  if (!parsed.success) return { error: firstIssue(parsed.error), email };

  const supabase = await authClient();
  if (!supabase) return { error: messages.unavailable, email };
  // Supabase answers the same whether or not the email has an account, and so do we.
  const { error } = await supabase.auth.resetPasswordForEmail(parsed.data.email);
  if (error && (error.status === 429 || !error.status || error.status >= 500)) {
    return { error: authMessage(error, messages.unavailable), email };
  }
  return { sent: true, email: parsed.data.email };
}

/**
 * A session that came from an emailed link: Supabase marks a verified reset link "otp" (older
 * versions "recovery"). Staff never sign in by email code otherwise; sign in is "password".
 */
function isRecoverySession(claims: JwtPayload | undefined): claims is JwtPayload {
  return Boolean(
    claims?.amr?.some((entry) => {
      const method = typeof entry === 'string' ? entry : entry.method;
      return method === 'otp' || method === 'recovery';
    }),
  );
}

export async function resetPassword(_state: AuthFormState, form: FormData): Promise<AuthFormState> {
  const parsed = newPasswordSchema.safeParse({
    tokenHash: form.get('tokenHash'),
    linkType: form.get('linkType') ?? undefined,
    password: form.get('password'),
  });
  if (!parsed.success) {
    const tokenMissing = parsed.error.issues.some((issue) => issue.path[0] === 'tokenHash');
    return tokenMissing
      ? { error: messages.linkExpired, linkExpired: true }
      : { error: firstIssue(parsed.error) };
  }
  // Sent only once the form has asked for it (accounts with two step verification).
  const typedCode = form.get('code');
  const code =
    typeof typedCode === 'string' && typedCode !== ''
      ? twoStepCodeSchema.safeParse({ code: typedCode })
      : undefined;
  if (code && !code.success) return { error: firstIssue(code.error), needCode: true };

  const supabase = await authClient();
  if (!supabase) return { error: messages.unavailable };
  // The link's token is used here, on submit, not when the page opens: mail scanners that open
  // links cannot use it up.
  const verified = await supabase.auth.verifyOtp({
    type: parsed.data.linkType,
    token_hash: parsed.data.tokenHash,
  });
  let authUserId = verified.data.user?.id;
  if (!authUserId) {
    // An earlier attempt with this link may have used the token and then failed (for example
    // the same password again, or a code still needed); its recovery session is still here.
    const { data } = await supabase.auth.getClaims();
    if (isRecoverySession(data?.claims)) authUserId = data.claims.sub;
  }
  if (!authUserId) return { error: messages.linkExpired, linkExpired: true };

  const staff = await staffForSignIn(appDb(), authUserId);
  if (!staff) {
    await supabase.auth.signOut({ scope: 'local' });
    return { error: messages.linkExpired, linkExpired: true };
  }

  // With two step verification on, Supabase changes the password only after a code (IAM-02).
  if (code?.success) {
    const { data: factors } = await supabase.auth.mfa.listFactors();
    const [factor] = factors?.totp ?? [];
    if (factor) {
      const { error } = await checkCode(supabase, factor.id, code.data.code);
      if (error) return { error: authMessage(error, messages.wrongCode), needCode: true };
    }
  }

  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) {
    if (error.code === 'insufficient_aal') return { error: messages.codeForReset, needCode: true };
    if (error.code === 'same_password') {
      return { error: 'That is your current password. Choose a different one.' };
    }
    return { error: authMessage(error, 'Choose a longer password.') };
  }
  await logAccess(staff, 'password_change');
  // Every device signs in again with the new password.
  await supabase.auth.signOut({ scope: 'global' });
  redirect('/app/sign-in?password=changed');
}

/** Signs out, including part way through two step verification. */
export async function signOut(): Promise<void> {
  const state = await signInState();
  const supabase = await authClient();
  if (supabase) await supabase.auth.signOut({ scope: 'local' });
  if (state?.stage === 'complete') await logAccess(state.staff, 'sign_out');
  redirect('/app/sign-in');
}
