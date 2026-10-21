/** The sign in, reset and offline pages: open without a session (IAM-01). */
export const publicStaffPath = /^\/app\/(sign-in|forgot-password|reset-password|offline)(\/|$)/;

/**
 * Where to go after signing in: the staff app page the person asked for, never another site and
 * never back to a sign in page. Anything else goes to the staff app home.
 */
export function safeNextPath(next: unknown): string {
  if (typeof next !== 'string' || next.startsWith('//') || next.includes('\\')) return '/app';
  let url: URL;
  try {
    url = new URL(next, 'https://clinic.invalid');
  } catch {
    return '/app';
  }
  if (url.origin !== 'https://clinic.invalid') return '/app';
  if (!/^\/app(\/|$)/.test(url.pathname) || publicStaffPath.test(url.pathname)) return '/app';
  return `${url.pathname}${url.search}`;
}
