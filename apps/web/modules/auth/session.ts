import 'server-only';
import { staffForSignIn, type StaffMember } from '@clinic-mx/db';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { cache } from 'react';
import { appDb } from '../../lib/db';
import { AuthNotConfiguredError, supabaseServer } from '../../lib/supabase/server';

/**
 * The signed in staff member for this request, or null: a valid Supabase session whose user is
 * linked to an active staff row with no passed end date. Read once per request.
 */
export const currentStaff = cache(async (): Promise<StaffMember | null> => {
  let supabase: Awaited<ReturnType<typeof supabaseServer>>;
  try {
    supabase = await supabaseServer();
  } catch (error) {
    if (error instanceof AuthNotConfiguredError) return null;
    throw error;
  }
  const { data } = await supabase.auth.getClaims();
  const authUserId = data?.claims.sub;
  if (!authUserId) return null;
  return (await staffForSignIn(appDb(), authUserId)) ?? null;
});

/** For signed in pages: the staff member, or a redirect to sign in. */
export async function requireStaff(): Promise<StaffMember> {
  const staff = await currentStaff();
  if (!staff) redirect('/app/sign-in');
  return staff;
}

/** The client's address for the audit trail, as Vercel passes it. */
export async function clientIp(): Promise<string | undefined> {
  const forwarded = (await headers()).get('x-forwarded-for');
  return forwarded?.split(',')[0]?.trim() || undefined;
}
