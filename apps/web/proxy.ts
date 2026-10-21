import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { serverEnv } from './lib/env';
import { authCookieOptions } from './lib/supabase/cookies';
import { publicStaffPath } from './modules/auth/next-path';

/**
 * Runs before every staff app request (IAM-01): refreshes the Supabase session cookies on our
 * server, and sends anyone without a session to sign in, remembering where they were going.
 * Whether the session belongs to an active staff member is checked by the signed in layout.
 */
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  const { pathname, search } = request.nextUrl;
  const { SUPABASE_URL, SUPABASE_ANON_KEY } = serverEnv();

  let signedIn = false;
  if (SUPABASE_URL && SUPABASE_ANON_KEY) {
    const supabase = createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      cookieOptions: authCookieOptions,
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (list) => {
          for (const { name, value } of list) request.cookies.set(name, value);
          response = NextResponse.next({ request });
          for (const { name, value, options } of list) {
            response.cookies.set(name, value, { ...options, ...authCookieOptions });
          }
        },
      },
    });
    const { data } = await supabase.auth.getClaims();
    signedIn = Boolean(data?.claims.sub);
  }

  if (!signedIn && !publicStaffPath.test(pathname)) {
    const signIn = request.nextUrl.clone();
    signIn.pathname = '/app/sign-in';
    signIn.search = pathname === '/app' ? '' : `?next=${encodeURIComponent(pathname + search)}`;
    return NextResponse.redirect(signIn);
  }
  return response;
}

export const config = { matcher: ['/app', '/app/:path*'] };
