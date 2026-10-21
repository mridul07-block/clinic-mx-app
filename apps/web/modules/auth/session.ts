import 'server-only';
import { currentStaffClaims, staffForSignIn, type StaffMember } from '@clinic-mx/db';
import { sameStaffClaims } from '@clinic-mx/schemas';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { cache } from 'react';
import { appDb } from '../../lib/db';
import { AuthNotConfiguredError, supabaseServer } from '../../lib/supabase/server';
import { safeNextPath } from './next-path';
import { signInStage, stagePath, type SignInStage } from './two-step';

export interface SignInState {
  staff: StaffMember;
  stage: SignInStage;
  /** A verified authenticator app is set up. */
  twoStepOn: boolean;
}

/**
 * Who is signing in on this request and how far they have got, or null: a valid Supabase session
 * whose user is linked to an active staff row with no passed end date, and whose role, ticks
 * and centres claim is current. The assurance level comes from the session's signed token, the
 * authenticator apps from Supabase Auth itself. Read once per request.
 */
export const signInState = cache(async (): Promise<SignInState | null> => {
  let supabase: Awaited<ReturnType<typeof supabaseServer>>;
  try {
    supabase = await supabaseServer();
  } catch (error) {
    if (error instanceof AuthNotConfiguredError) return null;
    throw error;
  }
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (!claims?.sub) return null;
  const staff = await staffForSignIn(appDb(), claims.sub);
  if (!staff) return null;
  // IAM-03: proxy.ts replaces a token whose role, ticks or centres are out of date. If that
  // failed, the request does not go on with old claims: the person signs in again.
  if (!sameStaffClaims(claims.clinic, await currentStaffClaims(appDb(), claims.sub))) return null;

  // aal2 means a code was entered; otherwise ask Supabase Auth, never the cookie.
  let twoStepOn = true;
  if (claims.aal !== 'aal2') {
    const { data: factors, error } = await supabase.auth.mfa.listFactors();
    if (error) return null;
    twoStepOn = factors.totp.length > 0;
  }
  return {
    staff,
    stage: signInStage({ role: staff.role, level: claims.aal, hasAuthenticator: twoStepOn }),
    twoStepOn,
  };
});

/** The fully signed in staff member, or null (not signed in, or two step verification pending). */
export const currentStaff = cache(async (): Promise<StaffMember | null> => {
  const state = await signInState();
  return state?.stage === 'complete' ? state.staff : null;
});

/** The staff app page this request is for, set by proxy.ts, as a `?next=` for later. */
async function nextQuery(): Promise<string> {
  const path = safeNextPath((await headers()).get('x-clinic-path'));
  return path === '/app' ? '' : `?next=${encodeURIComponent(path)}`;
}

/**
 * For signed in pages and every server action: the staff member, or a redirect to sign in or to
 * two step verification, returning to this page afterwards.
 */
export async function requireStaff(): Promise<StaffMember> {
  const state = await signInState();
  if (!state) redirect(`/app/sign-in${await nextQuery()}`);
  if (state.stage !== 'complete') redirect(`${stagePath[state.stage]}${await nextQuery()}`);
  return state.staff;
}

/** The client's address for the audit trail, as Vercel passes it. */
export async function clientIp(): Promise<string | undefined> {
  const forwarded = (await headers()).get('x-forwarded-for');
  return forwarded?.split(',')[0]?.trim() || undefined;
}
