import { currentStaffClaims } from '@clinic-mx/db';
import { sameStaffClaims } from '@clinic-mx/schemas';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { appDb } from './lib/db';
import { serverEnv } from './lib/env';
import { authCookieOptions } from './lib/supabase/cookies';
import { publicStaffPath } from './modules/auth/next-path';

/**
 * Runs before every staff app request (IAM-01): refreshes the Supabase session cookies on our
 * server, and sends anyone without a session to sign in, remembering where they were going.
 * Whether the session belongs to an active staff member, and has passed two step verification,
 * is checked by the pages (`requireStaff`); they read the page asked for from `x-clinic-path`.
 */
export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const { SUPABASE_URL, SUPABASE_ANON_KEY, DATABASE_URL } = serverEnv();
  const refreshed: { name: string; value: string; options: CookieOptions }[] = [];

  let signedIn = false;
  if (SUPABASE_URL && SUPABASE_ANON_KEY) {
    const supabase = createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      cookieOptions: authCookieOptions,
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (list) => {
          for (const cookie of list) {
            request.cookies.set(cookie.name, cookie.value);
            refreshed.push(cookie);
          }
        },
      },
    });
    const { data } = await supabase.auth.getClaims();
    const authUserId = data?.claims.sub;
    signedIn = Boolean(authUserId);
    // IAM-03: when the person's role, ticks or centres changed since the token was issued, a
    // new token (with the current claims, from the access token hook) replaces it now, before
    // the page or server action runs. The session keeps its two step level.
    if (authUserId && DATABASE_URL) {
      const current = await currentStaffClaims(appDb(), authUserId);
      if (!sameStaffClaims(data.claims.clinic, current)) await supabase.auth.refreshSession();
    }
  }

  let response: NextResponse;
  if (!signedIn && !publicStaffPath.test(pathname)) {
    const signIn = request.nextUrl.clone();
    signIn.pathname = '/app/sign-in';
    signIn.search = pathname === '/app' ? '' : `?next=${encodeURIComponent(pathname + search)}`;
    response = NextResponse.redirect(signIn);
  } else {
    // Overwrites anything the browser sent under this name.
    const headers = new Headers(request.headers);
    headers.set('x-clinic-path', pathname + search);
    response = NextResponse.next({ request: { headers } });
  }
  for (const { name, value, options } of refreshed) {
    response.cookies.set(name, value, { ...options, ...authCookieOptions });
  }
  return response;
}

export const config = { matcher: ['/app', '/app/:path*'] };
