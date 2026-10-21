import 'server-only';
import { AuthNotConfiguredError } from '../../lib/supabase/server';
import { supabaseAdmin } from '../../lib/supabase/admin';

/**
 * Logins that have not accepted their invite yet (IAM-06): the email is unconfirmed until the
 * invite link is used. Read from Supabase Auth on the server; empty when Auth is not set up.
 */
export async function loginsWithPendingInvite(): Promise<Set<string>> {
  const pending = new Set<string>();
  let admin: ReturnType<typeof supabaseAdmin>;
  try {
    admin = supabaseAdmin();
  } catch (error) {
    if (error instanceof AuthNotConfiguredError) return pending;
    throw error;
  }
  for (let page = 1; ; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    for (const user of data.users) if (!user.email_confirmed_at) pending.add(user.id);
    if (data.users.length < 200) return pending;
  }
}

/** Whether one login has not accepted its invite yet. */
export async function invitePending(authUserId: string | null): Promise<boolean> {
  if (!authUserId) return false;
  try {
    const { data, error } = await supabaseAdmin().auth.admin.getUserById(authUserId);
    if (error) throw error;
    return !data.user.email_confirmed_at;
  } catch (error) {
    if (error instanceof AuthNotConfiguredError) return false;
    throw error;
  }
}
