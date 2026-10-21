'use server';

import { logAccessEvent, staffActor, staffForSignIn } from '@clinic-mx/db';
import { newPasswordSchema, passwordResetRequestSchema, signInSchema } from '@clinic-mx/schemas';
import type { AuthError, JwtPayload } from '@supabase/supabase-js';
import { redirect } from 'next/navigation';
import type { z } from 'zod';
import { appDb } from '../../lib/db';
import { supabaseServer } from '../../lib/supabase/server';
import { safeNextPath } from './next-path';
import { clientIp, currentStaff } from './session';

/**
 * Staff sign in, sign out and password reset (IAM-01). Forms post here; only this server calls
 * Supabase Auth (rule 9). Messages never say whether an email has an account.
 */

export interface AuthFormState {
  error?: string;
  /** The reset link can no longer be used; offer a new one. */
  linkExpired?: boolean;
  /** The reset email was requested. */
  sent?: boolean;
  /** Typed values to show again after an error (never the password). */
  email?: string;
}

const signInFailed = 'That email and password do not match an active staff account.';
const unavailable = 'Sign in is not available right now. Try again in a few minutes.';
const tooMany = 'Too many attempts. Wait a few minutes, then try again.';
const linkExpired = 'This reset link has expired or was already used. Ask for a new one.';

const firstIssue = (error: z.ZodError) => error.issues[0]?.message ?? signInFailed;
const typedEmail = (form: FormData) => {
  const value = form.get('email');
  return typeof value === 'string' ? value : '';
};

/** Wrong details and refusals are the person's to fix; anything else is ours. */
function authMessage(error: AuthError, refused: string): string {
  if (error.status === 429) return tooMany;
  if (error.status && error.status >= 400 && error.status < 500) return refused;
  return unavailable;
}

async function client() {
  try {
    return await supabaseServer();
  } catch {
    return undefined;
  }
}

export async function signIn(_state: AuthFormState, form: FormData): Promise<AuthFormState> {
  const email = typedEmail(form);
  const parsed = signInSchema.safeParse({ email, password: form.get('password') });
  if (!parsed.success) return { error: firstIssue(parsed.error), email };

  const supabase = await client();
  if (!supabase) return { error: unavailable, email };
  const { data, error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) return { error: authMessage(error, signInFailed), email };

  // A login whose staff member is deactivated or past their end date gets no session.
  const staff = await staffForSignIn(appDb(), data.user.id);
  if (!staff) {
    await supabase.auth.signOut({ scope: 'local' });
    return { error: signInFailed, email };
  }
  await logAccessEvent(appDb(), {
    actor: staffActor(staff.id),
    ip: await clientIp(),
    action: 'sign_in',
    staffUserId: staff.id,
  });
  redirect(safeNextPath(form.get('next')));
}

export async function requestPasswordReset(
  _state: AuthFormState,
  form: FormData,
): Promise<AuthFormState> {
  const email = typedEmail(form);
  const parsed = passwordResetRequestSchema.safeParse({ email });
  if (!parsed.success) return { error: firstIssue(parsed.error), email };

  const supabase = await client();
  if (!supabase) return { error: unavailable, email };
  // Supabase answers the same whether or not the email has an account, and so do we.
  const { error } = await supabase.auth.resetPasswordForEmail(parsed.data.email);
  if (error && (error.status === 429 || !error.status || error.status >= 500)) {
    return { error: authMessage(error, unavailable), email };
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
    password: form.get('password'),
  });
  if (!parsed.success) {
    const tokenMissing = parsed.error.issues.some((issue) => issue.path[0] === 'tokenHash');
    return tokenMissing
      ? { error: linkExpired, linkExpired: true }
      : { error: firstIssue(parsed.error) };
  }

  const supabase = await client();
  if (!supabase) return { error: unavailable };
  // The link's token is used here, on submit, not when the page opens: mail scanners that open
  // links cannot use it up.
  const verified = await supabase.auth.verifyOtp({
    type: 'recovery',
    token_hash: parsed.data.tokenHash,
  });
  let authUserId = verified.data.user?.id;
  if (!authUserId) {
    // An earlier attempt with this link may have used the token and then failed (for example
    // the same password again); its recovery session is still in the cookies.
    const { data } = await supabase.auth.getClaims();
    if (isRecoverySession(data?.claims)) authUserId = data.claims.sub;
  }
  if (!authUserId) return { error: linkExpired, linkExpired: true };

  const staff = await staffForSignIn(appDb(), authUserId);
  if (!staff) {
    await supabase.auth.signOut({ scope: 'local' });
    return { error: linkExpired, linkExpired: true };
  }

  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) {
    if (error.code === 'same_password') {
      return { error: 'That is your current password. Choose a different one.' };
    }
    return { error: authMessage(error, 'Choose a longer password.') };
  }
  await logAccessEvent(appDb(), {
    actor: staffActor(staff.id),
    ip: await clientIp(),
    action: 'password_change',
    staffUserId: staff.id,
  });
  // Every device signs in again with the new password.
  await supabase.auth.signOut({ scope: 'global' });
  redirect('/app/sign-in?password=changed');
}

export async function signOut(): Promise<void> {
  const staff = await currentStaff();
  const supabase = await client();
  if (supabase) await supabase.auth.signOut({ scope: 'local' });
  if (staff) {
    await logAccessEvent(appDb(), {
      actor: staffActor(staff.id),
      ip: await clientIp(),
      action: 'sign_out',
      staffUserId: staff.id,
    });
  }
  redirect('/app/sign-in');
}
