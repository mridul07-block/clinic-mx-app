import type { CookieOptions } from '@supabase/ssr';

/** The Supabase session cookies: never readable by page scripts, sent only over HTTPS. */
export const authCookieOptions = {
  httpOnly: true,
  secure: true,
  sameSite: 'lax',
  path: '/',
} satisfies CookieOptions;
