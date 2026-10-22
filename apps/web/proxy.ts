import {
  activeGrant,
  currentStaffClaims,
  logAccessEvent,
  logSupportRequest,
  staffActor,
} from '@clinic-mx/db';
import {
  passwordSignInTime,
  sameStaffClaims,
  sessionVerdict,
  staffClaimsSchema,
  type SessionEndReason,
} from '@clinic-mx/schemas';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { appDb } from './lib/db';
import { serverEnv } from './lib/env';
import { requestAddress } from './lib/network';
import {
  DEVICE_COOKIE,
  KIOSK_COOKIE,
  LAST_SEEN_COOKIE,
  readDevice,
  readLastSeen,
  sessionCookieOptions,
} from './lib/session-cookies';
import { authCookieOptions } from './lib/supabase/cookies';
import { publicStaffPath } from './modules/auth/next-path';
import { getSetting } from './modules/settings/settings';

/** The session check of open pages (IAM-07); asking is not activity. */
const SESSION_PATH = '/app/session';

/** The last activity is written again only once it is this old, to keep cookies quiet. */
const LAST_SEEN_REFRESH_MS = 60_000;

/**
 * Requests that show the person is using the app: opening a page, or the open page's activity
 * ping (it pings while the person types or clicks). Not the session check, not a prefetch, and
 * not a server action: a cookie set on an action's answer makes Next render the page again,
 * which would, for example, replace a two step setup key the person is reading.
 */
function isActivity(request: NextRequest): boolean {
  if (request.nextUrl.pathname === SESSION_PATH) return request.method === 'POST';
  if (request.method !== 'GET' || request.headers.has('next-action')) return false;
  return !isPrefetch(request);
}

/**
 * A prefetch nobody asked for: a link the router fetches ahead (`next-router-prefetch`, or a
 * segment prefetch) or a browser prefetch. The router headers reach the proxy only because
 * next.config.ts sets `skipProxyUrlNormalize`; by default Next removes them first.
 */
function isPrefetch(request: NextRequest): boolean {
  const purpose = request.headers.get('sec-purpose') ?? request.headers.get('purpose') ?? '';
  return (
    request.headers.has('next-router-prefetch') ||
    request.headers.has('next-router-segment-prefetch') ||
    purpose.includes('prefetch')
  );
}

/** The query people see: without `_rsc`, the router's cache key, which the proxy now receives. */
function visibleSearch(url: URL): string {
  const query = new URLSearchParams(url.searchParams);
  query.delete('_rsc');
  return query.size ? `?${query.toString()}` : '';
}

/**
 * What a Velyx support login asked for (IAM-08), to log: a page (opened or navigated to) or a
 * server action. Not the session check or activity ping, and not a prefetch nobody asked for.
 */
function supportRequestKind(request: NextRequest): 'page' | 'action' | null {
  if (request.nextUrl.pathname === SESSION_PATH) return null;
  if (request.headers.has('next-action')) return 'action';
  if (request.method === 'GET' && !isPrefetch(request)) return 'page';
  return null;
}

/**
 * Runs before every staff app request.
 *
 * - IAM-01: refreshes the Supabase session cookies on our server, and sends anyone without a
 *   session to sign in, remembering where they were going.
 * - IAM-03: replaces a token whose role, ticks or centres are out of date.
 * - IAM-07: ends a desktop session after the idle minutes and a phone session after the phone
 *   days (settings), and keeps a desktop's last activity.
 * - IAM-08: logs every page and action a Velyx support login asks for under the active grant.
 * - IAM-10: a clinic tablet in kiosk mode (its cookie) opens nothing here: the home page and
 *   every staff page go to its welcome screen. It shows only /kiosk and the form sent to it.
 *
 * Whether the session belongs to an active staff member, and has passed two step verification,
 * is checked by the pages (`requireStaff`); they read the page asked for from `x-clinic-path`.
 */
export async function proxy(request: NextRequest) {
  if (request.cookies.has(KIOSK_COOKIE)) {
    const welcome = request.nextUrl.clone();
    welcome.pathname = '/kiosk';
    welcome.search = '';
    return NextResponse.redirect(welcome);
  }
  // The home page is matched only for the kiosk lock; it sends everyone else on to /app.
  if (request.nextUrl.pathname === '/') return NextResponse.next();
  const { pathname } = request.nextUrl;
  const search = visibleSearch(request.nextUrl);
  const { SUPABASE_URL, SUPABASE_ANON_KEY, DATABASE_URL } = serverEnv();
  const refreshed: { name: string; value: string; options: CookieOptions }[] = [];
  const device = readDevice(request.cookies.get(DEVICE_COOKIE)?.value);
  const lastSeen = readLastSeen(request.cookies.get(LAST_SEEN_COOKIE)?.value);

  let signedIn = false;
  let ended: SessionEndReason | undefined;
  let activeNow = false;
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
    if (authUserId && DATABASE_URL) {
      // IAM-03: when the person's role, ticks or centres changed since the token was issued, a
      // new token (with the current claims, from the access token hook) replaces it now, before
      // the page or server action runs. The session keeps its two step level.
      const current = await currentStaffClaims(appDb(), authUserId);
      if (!sameStaffClaims(data.claims.clinic, current)) await supabase.auth.refreshSession();

      // IAM-07: the session rules.
      const verdict = sessionVerdict({
        device,
        now: new Date(),
        lastSeen,
        signedInAt: passwordSignInTime(data.claims.amr),
        idleMinutes: await getSetting('security.desktop_idle_logout_minutes'),
        phoneDays: await getSetting('security.phone_session_days'),
      });
      if (verdict === 'ok') {
        const stale = !lastSeen || Date.now() - lastSeen.getTime() >= LAST_SEEN_REFRESH_MS;
        activeNow = device === 'desktop' && stale && isActivity(request);
        await logIfSupport(request, data.claims.clinic);
      } else {
        await supabase.auth.signOut({ scope: 'local' });
        signedIn = false;
        ended = verdict;
        const staff = staffClaimsSchema.safeParse(data.claims.clinic);
        if (staff.success) {
          await logAccessEvent(appDb(), {
            actor: staffActor(staff.data.staff_id),
            action: 'sign_out',
            staffUserId: staff.data.staff_id,
          });
        }
      }
    }
  }

  let response: NextResponse;
  if (!signedIn && pathname === SESSION_PATH) {
    response = NextResponse.json({ signedIn: false, reason: ended ?? 'ended' }, { status: 401 });
  } else if (!signedIn && !publicStaffPath.test(pathname)) {
    const signIn = request.nextUrl.clone();
    signIn.pathname = '/app/sign-in';
    const query = new URLSearchParams();
    if (ended) query.set('reason', ended);
    if (pathname !== '/app') query.set('next', pathname + search);
    signIn.search = query.size ? `?${query.toString()}` : '';
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
  if (activeNow) {
    response.cookies.set(LAST_SEEN_COOKIE, String(Date.now()), sessionCookieOptions);
  }
  if (ended) response.cookies.delete({ name: LAST_SEEN_COOKIE, path: '/' });
  return response;
}

/**
 * IAM-08, TAD section 5: every request under support access is audit logged, with the grant it
 * ran under. Only the path is kept, never the query string, which can hold search terms. Once
 * the grant has ended nothing is logged: the page refuses the request (signInState).
 */
async function logIfSupport(request: NextRequest, clinic: unknown) {
  const claims = staffClaimsSchema.safeParse(clinic);
  const kind = supportRequestKind(request);
  if (!claims.success || !claims.data.support || !kind) return;
  const grant = await activeGrant(appDb());
  if (!grant) return;
  await logSupportRequest(appDb(), {
    actor: staffActor(claims.data.staff_id),
    ip: requestAddress(request.headers),
    grantId: grant.id,
    path: request.nextUrl.pathname,
    kind,
  });
}

export const config = { matcher: ['/', '/app', '/app/:path*'] };
