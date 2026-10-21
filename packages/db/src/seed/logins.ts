import { createClient } from '@supabase/supabase-js';
import { eq, sql } from 'drizzle-orm';
import { setAuditContext, systemActor } from '../audit';
import type { Db } from '../client';
import { staffUser } from '../schema';
import { seedStaff } from './data';

export interface SeedLoginConfig {
  supabaseUrl: string;
  serviceRoleKey: string;
  /** One password for every test staff login, from CLINIC_MX_SEED_STAFF_PASSWORD. */
  password: string;
}

/** The login settings from the environment, or why logins are skipped. */
export function seedLoginConfig(env: NodeJS.ProcessEnv): SeedLoginConfig | string {
  const missing = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'CLINIC_MX_SEED_STAFF_PASSWORD']
    .filter((name) => !env[name])
    .join(', ');
  if (missing) return `staff logins skipped (${missing} not set)`;
  return {
    supabaseUrl: env.SUPABASE_URL ?? '',
    serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY ?? '',
    password: env.CLINIC_MX_SEED_STAFF_PASSWORD ?? '',
  };
}

/**
 * Gives every seed staff member a Supabase Auth login with the seed password and links it to
 * their staff row (IAM-01). Runs from the seed script only, never in the app. Safe to repeat:
 * existing logins get the password again, links that are already right are not rewritten.
 */
export async function seedStaffLogins(db: Db, config: SeedLoginConfig) {
  const admin = createClient(config.supabaseUrl, config.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const existing = new Map<string, string>();
  for (let page = 1; ; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    for (const user of data.users) if (user.email) existing.set(user.email.toLowerCase(), user.id);
    if (data.users.length < 200) break;
  }

  const links = new Map<string, string>();
  for (const member of seedStaff) {
    if (!member.id) throw new Error(`Seed staff ${member.email} has no id`);
    const email = member.email.toLowerCase();
    const id = existing.get(email);
    if (id) {
      const { error } = await admin.auth.admin.updateUserById(id, { password: config.password });
      if (error) throw error;
      links.set(member.id, id);
    } else {
      const { data, error } = await admin.auth.admin.createUser({
        email,
        password: config.password,
        email_confirm: true,
      });
      if (error) throw error;
      links.set(member.id, data.user.id);
    }
  }

  await db.transaction(async (tx) => {
    await setAuditContext(tx, { actor: systemActor('seed') });
    for (const [staffUserId, authUserId] of links) {
      await tx
        .update(staffUser)
        .set({ authUserId, updatedAt: sql`now()` })
        .where(
          sql`${eq(staffUser.id, staffUserId)} and ${staffUser.authUserId} is distinct from ${authUserId}`,
        );
    }
  });
  return { logins: links.size };
}
