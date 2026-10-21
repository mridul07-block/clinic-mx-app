import 'server-only';
import { logAccessEvent, staffActor, type AccessAction, type StaffMember } from '@clinic-mx/db';
import type { AuthError } from '@supabase/supabase-js';
import type { z } from 'zod';
import { appDb } from '../../lib/db';
import { supabaseServer } from '../../lib/supabase/server';
import { clientIp } from './session';

/** What the sign in, two step and reset forms show after a post (IAM-01, IAM-02). */
export interface AuthFormState {
  error?: string;
  /** The reset link can no longer be used; offer a new one. */
  linkExpired?: boolean;
  /** The reset email was requested. */
  sent?: boolean;
  /** The reset also needs a code from the authenticator app. */
  needCode?: boolean;
  /** Typed values to show again after an error (never the password). */
  email?: string;
}

export const messages = {
  signInFailed: 'That email and password do not match an active staff account.',
  unavailable: 'Sign in is not available right now. Try again in a few minutes.',
  // IAM-08: shown only once the password was right, so it says nothing about other emails.
  supportOff: "Support access is off. The clinic's Super Admin can turn it on.",
  tooMany: 'Too many attempts. Wait a few minutes, then try again.',
  linkExpired: 'This reset link has expired or was already used. Ask for a new one.',
  wrongCode:
    'That code did not work. Enter the newest code from your authenticator app; if it keeps failing, check the time on your phone is set automatically.',
  codeForReset:
    'Your account has two step verification. Enter the code from your authenticator app too.',
};

export const firstIssue = (error: z.ZodError) => error.issues[0]?.message ?? messages.signInFailed;

/** Wrong details and refusals are the person's to fix; anything else is ours. */
export function authMessage(error: AuthError, refused: string): string {
  if (error.status === 429) return messages.tooMany;
  if (error.status && error.status >= 400 && error.status < 500) return refused;
  return messages.unavailable;
}

/** The request's Supabase client, or undefined when Auth is not configured. */
export async function authClient() {
  try {
    return await supabaseServer();
  } catch {
    return undefined;
  }
}

export async function logAccess(staff: StaffMember, action: AccessAction): Promise<void> {
  await logAccessEvent(appDb(), {
    actor: staffActor(staff.id),
    ip: await clientIp(),
    action,
    staffUserId: staff.id,
  });
}

/** `?next=` for a two step page, keeping the page asked for. */
export function nextParam(next: string): string {
  return next === '/app' ? '' : `?next=${encodeURIComponent(next)}`;
}

type AuthClient = Awaited<ReturnType<typeof supabaseServer>>;

/**
 * Checks a code from the authenticator app. Supabase Auth can fail two checks for the same
 * person that arrive together (a database deadlock, answered with a server error), so a server
 * error is tried again twice after a short, jittered pause. Wrong codes are never retried.
 */
export async function checkCode(supabase: AuthClient, factorId: string, code: string) {
  for (let attempt = 1; ; attempt++) {
    const result = await supabase.auth.mfa.challengeAndVerify({ factorId, code });
    const serverError = (result.error?.status ?? 0) >= 500;
    if (!serverError || attempt === 3) return result;
    await new Promise((resolve) => setTimeout(resolve, 150 * attempt + Math.random() * 150));
  }
}
