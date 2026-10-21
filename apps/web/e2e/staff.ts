import { expect, type Page } from '@playwright/test';

// Signing in for end to end tests (IAM-01). The staff are the seed's generated test people
// (packages/db/src/seed/data.ts); `pnpm db:seed` gives each a login with
// CLINIC_MX_SEED_STAFF_PASSWORD on the local Supabase stack (docs/runbooks/auth.md).

export const testStaff = {
  physio: { email: 'physio.hsr@clinicmx.test', name: 'Test Consultant Physio HSR' },
  finance: { email: 'finance@clinicmx.test', name: 'Test Finance' },
  manager: { email: 'manager@clinicmx.test', name: 'Test Centre Manager' },
  // Password reset tests change the password, so each project has its own account.
  resetPhone: { email: 'desk.koramangala@clinicmx.test', name: 'Test Front Desk Koramangala' },
  resetDesktop: { email: 'desk.whitefield@clinicmx.test', name: 'Test Front Desk Whitefield' },
} as const;

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set: start and seed the local Supabase stack first.`);
  }
  return value;
}

export const seedPassword = () => required('CLINIC_MX_SEED_STAFF_PASSWORD');
export const supabaseUrl = () => required('SUPABASE_URL');

/** Signs in through the sign in page and waits for the page it leads to. */
export async function signIn(page: Page, email: string, password = seedPassword()) {
  if (!page.url().includes('/app/sign-in')) await page.goto('/app/sign-in');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).not.toHaveURL(/\/app\/sign-in/);
}

/**
 * Sets a login's password through the Supabase admin API, from the test runner (never the
 * browser). Puts reset test accounts back as the seed left them.
 */
export async function setPassword(email: string, password: string) {
  const headers = {
    apikey: required('SUPABASE_SERVICE_ROLE_KEY'),
    Authorization: `Bearer ${required('SUPABASE_SERVICE_ROLE_KEY')}`,
    'Content-Type': 'application/json',
  };
  const list = (await (
    await fetch(`${supabaseUrl()}/auth/v1/admin/users?page=1&per_page=200`, { headers })
  ).json()) as { users: { id: string; email?: string }[] };
  const user = list.users.find((u) => u.email === email);
  if (!user) throw new Error(`No login for ${email}`);
  const response = await fetch(`${supabaseUrl()}/auth/v1/admin/users/${user.id}`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({ password }),
  });
  expect(response.ok).toBe(true);
}

const mailpit = () => process.env.MAILPIT_URL ?? 'http://127.0.0.1:54324';
const toQuery = (email: string) => encodeURIComponent(`to:"${email}"`);

/** Deletes every email to `email` in the local mail catcher (Mailpit). */
export async function clearMail(email: string) {
  const response = await fetch(`${mailpit()}/api/v1/search?query=${toQuery(email)}`, {
    method: 'DELETE',
  });
  expect(response.ok).toBe(true);
}

/** The reset link in the email to `email`, once it arrives in the local mail catcher. */
export async function resetLinkFor(email: string): Promise<string> {
  let link: string | undefined;
  await expect
    .poll(
      async () => {
        const search = (await (
          await fetch(`${mailpit()}/api/v1/search?query=${toQuery(email)}`)
        ).json()) as { messages: { ID: string }[] };
        const [newest] = search.messages;
        if (!newest) return undefined;
        const message = (await (
          await fetch(`${mailpit()}/api/v1/message/${newest.ID}`)
        ).json()) as { HTML: string };
        link = /href="([^"]*\/app\/reset-password\?token_hash=[^"]+)"/.exec(message.HTML)?.[1];
        return link;
      },
      { timeout: 15_000 },
    )
    .toBeTruthy();
  return (link ?? '').replaceAll('&amp;', '&');
}
