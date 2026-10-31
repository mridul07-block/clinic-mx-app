import { inArray } from 'drizzle-orm';
import type { DbOrTransaction } from '../versioned';
import { setting } from '../schema';

/**
 * What keeps the demo data where it belongs (docs/runbooks/demo-data.md): only the local stack or
 * the staging project, and never while WhatsApp could send to the made up numbers.
 */

export type DemoTarget = 'local' | 'staging';

/** The target the environment names and the database it points at, or why it is refused. */
export function demoTarget(env: NodeJS.ProcessEnv): { target: DemoTarget } | { refused: string } {
  const target = env.CLINIC_MX_SEED_TARGET;
  const url = env.DIRECT_DATABASE_URL;
  if (!url) return { refused: 'DIRECT_DATABASE_URL is not set.' };
  let address: URL;
  try {
    address = new URL(url);
  } catch {
    return { refused: 'DIRECT_DATABASE_URL is not a database address.' };
  }
  const host = address.hostname;
  if (target === 'local') {
    return ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(host)
      ? { target: 'local' }
      : { refused: 'The local target must point at the local stack (127.0.0.1).' };
  }
  if (target === 'staging') {
    const ref = env.SUPABASE_PROJECT_REF;
    if (!ref) return { refused: 'SUPABASE_PROJECT_REF is not set, so staging is not recognised.' };
    // The direct host is db.<ref>.supabase.co; the pooler's user name is postgres.<ref>.
    return host.includes(ref) || address.username.endsWith(`.${ref}`)
      ? { target: 'staging' }
      : { refused: 'DIRECT_DATABASE_URL is not the staging project.' };
  }
  return { refused: `CLINIC_MX_SEED_TARGET must be local or staging; got "${target ?? ''}".` };
}

/**
 * Refuses while WhatsApp could reach the demo patients: sending must be limited to the test
 * recipients (WA-01), and no demo number may be one of them.
 */
export async function messagingRefusal(
  db: DbOrTransaction,
  demoPhones: readonly string[],
): Promise<string | undefined> {
  const rows = await db
    .select({ key: setting.key, value: setting.value })
    .from(setting)
    .where(inArray(setting.key, ['whatsapp.test_recipients_only', 'whatsapp.test_recipients']));
  const value = (key: string) => rows.find((row) => row.key === key)?.value;
  if (value('whatsapp.test_recipients_only') !== true) {
    return 'whatsapp.test_recipients_only must be on, so WhatsApp never reaches the demo numbers.';
  }
  const recipients = value('whatsapp.test_recipients');
  const listed = Array.isArray(recipients) ? recipients.map(String) : [];
  if (demoPhones.some((phone) => listed.includes(phone))) {
    return 'A demo number is on whatsapp.test_recipients; take it off first.';
  }
  return undefined;
}
