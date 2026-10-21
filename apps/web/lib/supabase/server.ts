import 'server-only';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { serverEnv } from '../env';
import { authCookieOptions } from './cookies';

/**
 * Supabase Auth for the server only (IAM-01, rule 9, TAD section 5). The browser never receives
 * the Supabase URL or a key and never calls Supabase: it posts to our server, which calls Auth
 * and keeps the session in HTTP only, secure, same site cookies (./cookies.ts).
 */
export class AuthNotConfiguredError extends Error {
  override name = 'AuthNotConfiguredError';
}

export function supabaseConfig() {
  const { SUPABASE_URL, SUPABASE_ANON_KEY } = serverEnv();
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new AuthNotConfiguredError('SUPABASE_URL and SUPABASE_ANON_KEY must be set.');
  }
  return { url: SUPABASE_URL, key: SUPABASE_ANON_KEY };
}

/** A Supabase client bound to this request's cookies (server components and server actions). */
export async function supabaseServer() {
  const { url, key } = supabaseConfig();
  const store = await cookies();
  return createServerClient(url, key, {
    cookieOptions: authCookieOptions,
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try {
          for (const { name, value, options } of list) {
            store.set(name, value, { ...options, ...authCookieOptions });
          }
        } catch {
          // Server components cannot set cookies; the proxy refreshes the session instead.
        }
      },
    },
  });
}
