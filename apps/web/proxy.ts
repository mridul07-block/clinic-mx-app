import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
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
  const { SUPABASE_URL, SUPABASE_ANON_KEY } = serverEnv();
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
    signedIn = Boolean(data?.claims.sub);
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
