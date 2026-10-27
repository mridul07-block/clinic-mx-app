/** The sign in, reset and offline pages: open without a session (IAM-01). */
export const publicStaffPath = /^\/app\/(sign-in|forgot-password|reset-password|offline)(\/|$)/;

/**
 * Where to go after signing in: the staff app page the person asked for, never another site and
 * never back to a sign in page. Anything else goes to `home`, the person's landing screen.
 */
export function safeNextPath(next: unknown, home = '/app'): string {
  if (typeof next !== 'string' || next.startsWith('//') || next.includes('\\')) return home;
  let url: URL;
  try {
    url = new URL(next, 'https://clinic.invalid');
  } catch {
    return home;
  }
  if (url.origin !== 'https://clinic.invalid') return home;
  if (!/^\/app(\/|$)/.test(url.pathname) || publicStaffPath.test(url.pathname)) return home;
  if (/^\/app\/(two-step|session)(\/|$)/.test(url.pathname)) return home;
  // The staff app home itself is no page in particular: the person's own landing screen.
  if (url.pathname === '/app' && !url.search) return home;
  return `${url.pathname}${url.search}`;
}

/**
 * Where each role lands after signing in (Frontend Specification section 5: each role lands on
 * the screen that answers "what needs me now"). The Front Desk lands on Today (INT-01) and
 * physiotherapists on My patients today (CLN-01), Centre Managers on their dashboard's Alerts
 * (DSH-03); the other roles' landing screens come with their tickets.
 */
export function homePath(role: string): string {
  if (role === 'front_desk') return '/app/today';
  if (role === 'physiotherapist') return '/app/my-patients';
  if (role === 'centre_manager') return '/app/dashboard/alerts';
  return '/app';
}
