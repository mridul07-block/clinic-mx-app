import 'server-only';
import { createClient } from '@supabase/supabase-js';
import { serverEnv } from '../env';
import { AuthNotConfiguredError } from './server';

/**
 * Supabase Auth with the service role key, for admin actions on other people's logins. Server
 * only; callers check the acting staff member's permission first.
 */
export function supabaseAdmin() {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = serverEnv();
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new AuthNotConfiguredError('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.');
  }
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export type SupabaseAdmin = ReturnType<typeof supabaseAdmin>;
