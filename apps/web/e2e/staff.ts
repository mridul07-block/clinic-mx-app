import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  centre,
  createDb,
  endStaffSessions,
  setStaffMemberActive,
  staffUser,
  staffUserCentre,
  supportGrant,
  systemActor,
  withActor,
  withStaffAccess,
} from '@clinic-mx/db';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { createServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import { and, eq, gt, lt, sql } from 'drizzle-orm';
import { DEVICE_COOKIE, LAST_SEEN_COOKIE } from '../lib/session-cookies';
import { authCookieOptions } from '../lib/supabase/cookies';
import { homePath } from '../modules/auth/next-path';
import { totpCode } from './totp';

// Signing in for end to end tests (IAM-01, IAM-02). The staff are the seed's generated test
// people (packages/db/src/seed/data.ts); `pnpm db:seed` gives each a login with
// CLINIC_MX_SEED_STAFF_PASSWORD on the local Supabase stack (docs/runbooks/auth.md), and
// global-setup.ts gives the accounts that sign in with a code an authenticator app.
//
// Tests running side by side never sign in as the same person: Supabase Auth refuses one of two
// code checks for one person that overlap, and ends that person's other half finished sign ins.
// So each test file has its own account per project (phone, desktop).

export const testStaff = {
  physio: {
    email: 'physio.hsr@clinicmx.test',
    name: 'Test Consultant Physio HSR',
    role: 'Physiotherapist',
  },
  manager: { email: 'manager@clinicmx.test', name: 'Test Centre Manager', role: 'Centre Manager' },
  finance: { email: 'finance@clinicmx.test', name: 'Test Finance', role: 'Finance' },
  superAdmin: { email: 'super.admin@clinicmx.test', name: 'Test Super Admin', role: 'Super Admin' },
  // Front Desk, never asked for a code; signs in only, so any test may use it.
  desk: { email: 'desk.hsr@clinicmx.test', name: 'Test Front Desk HSR', role: 'Front Desk' },
  // Tests that change an account (password, two step setup).
  resetPhone: { email: 'desk.koramangala@clinicmx.test', name: 'Test Front Desk Koramangala' },
  resetDesktop: { email: 'desk.whitefield@clinicmx.test', name: 'Test Front Desk Whitefield' },
  setupPhone: { email: 'physio.koramangala@clinicmx.test', name: 'Test Physio Koramangala' },
  setupDesktop: {
    email: 'physio.whitefield@clinicmx.test',
    name: 'Test Consultant Physio Whitefield',
  },
  // Super Admins for staff-management.spec.ts (IAM-06).
  adminPhone: { email: 'admin.phone@clinicmx.test', name: 'Test Staff Admin Phone' },
  adminDesktop: { email: 'admin.desktop@clinicmx.test', name: 'Test Staff Admin Desktop' },
} as const;

/** Accounts global setup gives an authenticator app. */
export const accountsWithAuthenticator = [
  testStaff.physio,
  testStaff.manager,
  testStaff.finance,
  testStaff.superAdmin,
  testStaff.adminPhone,
  testStaff.adminDesktop,
];

interface TestAccount {
  email: string;
  name: string;
  role?: string;
}

const perProject = <T extends TestAccount>(phone: T, desktop: T): T =>
  test.info().project.name === 'phone' ? phone : desktop;

type WithRole = TestAccount & { role: string };

/** The account autosave.spec.ts signs in with. */
export const autosaveStaff = () => perProject<WithRole>(testStaff.physio, testStaff.manager);
/** The account auth.spec.ts signs in with. */
export const signInStaff = () => perProject<WithRole>(testStaff.finance, testStaff.superAdmin);
/** The account two-step.spec.ts sets two step verification up for. */
export const setupStaff = () =>
  perProject<TestAccount>(testStaff.setupPhone, testStaff.setupDesktop);
/** The Super Admin staff-management.spec.ts signs in with. */
export const staffAdmin = () =>
  perProject<TestAccount>(testStaff.adminPhone, testStaff.adminDesktop);
/** The Front Desk account auth.spec.ts changes (password, two step on). */
export const changingDeskStaff = () =>
  perProject<TestAccount>(testStaff.resetPhone, testStaff.resetDesktop);

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set: start and seed the local Supabase stack first.`);
  }
  return value;
}

export const seedPassword = () => required('CLINIC_MX_SEED_STAFF_PASSWORD');
export const supabaseUrl = () => required('SUPABASE_URL');

function twoStepSecret(email: string): string {
  const secrets = JSON.parse(
    readFileSync(join(import.meta.dirname, '.auth', 'two-step.json'), 'utf8'),
  ) as Record<string, string>;
  const secret = secrets[email];
  if (!secret) throw new Error(`No authenticator app for ${email} from global setup`);
  return secret;
}

/** Enters the current code from `secret` on the two step page. */
export async function enterCode(page: Page, secret: string) {
  await page.getByLabel('6 digit code').fill(totpCode(secret));
  await page.getByRole('button', { name: 'Verify' }).click();
}

/**
 * These specs test signing in itself or what it records, or need what the sign in page sets up
 * (the service worker, for offline tests), so they use the real screens.
 */
const specsUsingTheForm =
  /(auth|two-step|sessions|rate-limits|support-access|staff-management|audit-log|permissions|smoke|kiosk|a11y|autosave|pwa)\.spec\.ts$/;

/**
 * Gives the page the session the sign in form would give, without its screens, then opens the
 * person's landing screen. The cookies come from the same Supabase library the app uses, so they
 * are the real thing; measured on 3 November 2026 it saves about 8% of a test's time (FND-13b,
 * docs/runbooks/local-gate.md). Only for tests about something else: see `specsUsingTheForm`.
 */
async function signInDirectly(page: Page, email: string, secret: string | undefined) {
  let jar: { name: string; value: string }[] = [];
  const supabase = createServerClient(supabaseUrl(), required('SUPABASE_ANON_KEY'), {
    cookieOptions: authCookieOptions,
    cookies: {
      getAll: () => jar,
      setAll: (list) => {
        const names = new Set(list.map((cookie) => cookie.name));
        jar = [
          ...jar.filter((cookie) => !names.has(cookie.name)),
          ...list
            .filter((cookie) => cookie.value !== '')
            .map(({ name, value }) => ({ name, value })),
        ];
      },
    },
  });
  const { error } = await supabase.auth.signInWithPassword({ email, password: seedPassword() });
  if (error) throw error;
  if (secret) {
    const { data, error: listed } = await supabase.auth.mfa.listFactors();
    const factor = data?.totp[0];
    if (listed || !factor) throw listed ?? new Error(`No authenticator app for ${email}`);
    // Two code checks at once can deadlock in Supabase Auth, as the app's own retries allow for.
    for (let attempt = 1; ; attempt += 1) {
      const { error: wrong } = await supabase.auth.mfa.challengeAndVerify({
        factorId: factor.id,
        code: totpCode(secret),
      });
      if (!wrong) break;
      if (attempt === 3) throw wrong;
    }
  }
  const session = (name: string, value: string) => ({
    name,
    value,
    domain: 'localhost',
    path: '/',
    httpOnly: true,
    secure: authCookieOptions.secure,
    sameSite: 'Lax' as const,
  });
  await page
    .context()
    .addCookies([
      ...jar.map(({ name, value }) => session(name, value)),
      session(DEVICE_COOKIE, test.info().project.name === 'phone' ? 'phone' : 'desktop'),
      session(LAST_SEEN_COOKIE, String(Date.now())),
    ]);
  const { role } = await staffRow(email);
  await page.goto(homePath(role));
}

const usesTheForm = (page: Page) =>
  specsUsingTheForm.test(test.info().file) || page.url().includes('/app/sign-in');

/**
 * Signs in, with a code from the authenticator app when the account has one from global setup, and
 * waits for the page it leads to. Through the sign in page where that is what is being tested, or
 * with another password; otherwise directly.
 */
export async function signIn(page: Page, email: string, password = seedPassword()) {
  if (password === seedPassword() && !usesTheForm(page)) {
    const withCode = accountsWithAuthenticator.some((account) => account.email === email);
    await signInDirectly(page, email, withCode ? twoStepSecret(email) : undefined);
    return;
  }
  if (!page.url().includes('/app/sign-in')) await page.goto('/app/sign-in');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).not.toHaveURL(/\/app\/sign-in/);
  if (new URL(page.url()).pathname === '/app/two-step') {
    await enterCode(page, twoStepSecret(email));
    await expect(page).not.toHaveURL(/\/app\/two-step/);
  }
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
  const response = await fetch(`${supabaseUrl()}/auth/v1/admin/users/${await authUserId(email)}`, {
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

const adminClient = () =>
  createClient(supabaseUrl(), required('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  });

// The login linked to the staff row, rather than a search of every login: tests add logins
// (temporaryDesk), and a list of them is paged.
async function authUserId(email: string): Promise<string> {
  const { authUserId: id } = await staffRow(email);
  if (!id) throw new Error(`No login for ${email}: run pnpm db:seed with the staff password.`);
  return id;
}

/** Removes every authenticator app from a login, as the Super Admin reset does. */
export async function clearTwoStep(email: string) {
  const admin = adminClient();
  const userId = await authUserId(email);
  const { data, error } = await admin.auth.admin.mfa.listFactors({ userId });
  if (error) throw error;
  for (const factor of data.factors) {
    const removed = await admin.auth.admin.mfa.deleteFactor({ userId, id: factor.id });
    if (removed.error) throw removed.error;
  }
}

/** Adds an authenticator app to a login through Supabase Auth; returns its secret. */
export async function addAuthenticator(email: string, password = seedPassword()): Promise<string> {
  const client = createClient(supabaseUrl(), required('SUPABASE_ANON_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const signedIn = await client.auth.signInWithPassword({ email, password });
  if (signedIn.error) throw signedIn.error;
  const enrolled = await client.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'Tests' });
  if (enrolled.error) throw enrolled.error;
  const verified = await client.auth.mfa.challengeAndVerify({
    factorId: enrolled.data.id,
    code: totpCode(enrolled.data.totp.secret),
  });
  if (verified.error) throw verified.error;
  return enrolled.data.totp.secret;
}

/**
 * The claims of the access token in the browser's session cookie, read by the test runner (the
 * page cannot read the cookie). @supabase/ssr stores the session as "base64-" and base64url JSON,
 * split over numbered cookies when long.
 */
export async function sessionTokenClaims(
  context: BrowserContext,
): Promise<Record<string, unknown>> {
  const parts = (await context.cookies())
    .filter((cookie) => {
      // "sb-<ref>-auth-token", or one of its numbered parts; not the code verifier cookies.
      const base = cookie.name.replace(/\.\d+$/, '');
      return base.startsWith('sb-') && base.endsWith('-auth-token');
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true }));
  const raw = parts.map((cookie) => cookie.value).join('');
  const json = raw.startsWith('base64-')
    ? Buffer.from(raw.slice('base64-'.length), 'base64url').toString('utf8')
    : decodeURIComponent(raw);
  const session = JSON.parse(json) as { access_token: string };
  const [, payload = ''] = session.access_token.split('.');
  return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<string, unknown>;
}

let database: ReturnType<typeof createDb> | undefined;
const testDb = () => {
  database ??= createDb(required('DIRECT_DATABASE_URL'), { max: 1, idleTimeoutSeconds: 1 });
  return database.db;
};

/** The seed staff row for a test account. */
export async function staffRow(email: string) {
  const [row] = await testDb().select().from(staffUser).where(eq(staffUser.email, email));
  if (!row) throw new Error(`No staff row for ${email}`);
  return row;
}

/** Changes a staff row and its centres in the database, as the Super Admin's staff screen will. */
export async function changeStaff(
  email: string,
  change: { values?: Partial<typeof staffUser.$inferInsert>; centres?: string[] },
) {
  const { id } = await staffRow(email);
  await withActor(testDb(), systemActor('tests'), async (tx) => {
    if (change.values) await tx.update(staffUser).set(change.values).where(eq(staffUser.id, id));
    if (change.centres) {
      await tx.delete(staffUserCentre).where(eq(staffUserCentre.staffUserId, id));
      if (change.centres.length > 0) {
        await tx
          .insert(staffUserCentre)
          .values(change.centres.map((centreId) => ({ staffUserId: id, centreId })));
      }
    }
  });
}

/** The ids of a staff member's assigned centres. */
export async function staffCentres(email: string): Promise<string[]> {
  const { id } = await staffRow(email);
  const rows = await testDb()
    .select({ centreId: staffUserCentre.centreId })
    .from(staffUserCentre)
    .where(eq(staffUserCentre.staffUserId, id));
  return rows.map((row) => row.centreId);
}

/** A seed centre's id, by name. */
export async function centreId(name: string): Promise<string> {
  const [row] = await testDb().select({ id: centre.id }).from(centre).where(eq(centre.name, name));
  if (!row) throw new Error(`No centre ${name}`);
  return row.id;
}

/**
 * A new Front Desk member at HSR Layout with a login and the seed password, made for one test
 * (IAM-07), so changing or deactivating them touches no shared account. The row stays afterwards
 * (deactivated): staff are never deleted.
 */
export async function temporaryDesk(): Promise<{ id: string; email: string; name: string }> {
  const suffix = crypto.randomUUID().slice(0, 8);
  const email = `temporary.${suffix}@clinicmx.test`;
  const name = `Test Temporary ${suffix}`;
  const { data, error } = await adminClient().auth.admin.createUser({
    email,
    password: seedPassword(),
    email_confirm: true,
  });
  if (error) throw error;
  const hsr = await centreId('HSR Layout');
  const id = await withActor(testDb(), systemActor('tests'), async (tx) => {
    const [row] = await tx
      .insert(staffUser)
      .values({ email, name, role: 'front_desk', authUserId: data.user.id })
      .returning({ id: staffUser.id });
    if (!row) throw new Error('temporary staff row not added');
    await tx.insert(staffUserCentre).values({ staffUserId: row.id, centreId: hsr });
    return row.id;
  });
  return { id, email, name };
}

/**
 * Deactivates a staff member the way the Super Admin's staff service does: as the seed Super
 * Admin under row level security, ending their Supabase sessions. Returns how many ended.
 */
export async function deactivateAsSuperAdmin(staffUserId: string): Promise<number> {
  const admin = await staffRow(testStaff.superAdmin.email);
  const actor = {
    id: admin.id,
    email: admin.email,
    name: admin.name,
    role: admin.role,
    treatsPatients: admin.treatsPatients,
    consultant: admin.consultant,
    centreIds: [],
    support: false,
  };
  return withStaffAccess(testDb(), { actor }, async (tx) => {
    await setStaffMemberActive(tx, staffUserId, false);
    return endStaffSessions(tx, staffUserId);
  });
}

/** How many Supabase sessions a login has. */
export async function sessionCount(email: string): Promise<number> {
  const rows = await testDb().execute<{ n: number }>(
    sql`select count(*)::int as n from auth.sessions s join auth.users u on u.id = s.user_id where u.email = ${email}`,
  );
  return rows[0]?.n ?? 0;
}

/**
 * A new Super Admin login with the seed password and an authenticator app, made for one test, so
 * no other test signs in as them at the same time. `support` makes it a Velyx support login
 * (IAM-08). The row stays afterwards: staff are never deleted.
 */
export function temporarySuperAdmin({ support }: { support: boolean }) {
  return temporaryWithCode(support ? 'support' : 'super_admin');
}

/**
 * A new login of one role with the seed password and an authenticator app, made for one test
 * (SET-02 signs in as Finance and a physiotherapist). The row stays afterwards: staff are never
 * deleted. A physiotherapist always treats patients (G5).
 */
export async function temporaryWithCode(
  role: 'super_admin' | 'support' | 'finance' | 'physiotherapist' | 'centre_manager',
  /** Centres to assign, by name (SET-04 signs in a Centre Manager and a physio at HSR Layout). */
  centreNames: string[] = [],
  /** A physio with the Consultant tick (CLN-02 consultations). */
  options: { consultant?: boolean } = {},
) {
  const suffix = crypto.randomUUID().slice(0, 8);
  const label = {
    super_admin: 'admin',
    support: 'support',
    finance: 'finance',
    physiotherapist: 'physio',
    centre_manager: 'manager',
  }[role];
  const email = `temporary.${label}.${suffix}@clinicmx.test`;
  const name = `Test Temporary ${label[0]?.toUpperCase() ?? ''}${label.slice(1)} ${suffix}`;
  const { data, error } = await adminClient().auth.admin.createUser({
    email,
    password: seedPassword(),
    email_confirm: true,
  });
  if (error) throw error;
  const centres = await Promise.all(centreNames.map((centreName) => centreId(centreName)));
  const id = await withActor(testDb(), systemActor('tests'), async (tx) => {
    const [row] = await tx
      .insert(staffUser)
      .values({
        email,
        name,
        role: role === 'support' ? 'super_admin' : role,
        velyxSupport: role === 'support',
        treatsPatients: role === 'physiotherapist',
        consultant: role === 'physiotherapist' && options.consultant === true,
        authUserId: data.user.id,
      })
      .returning({ id: staffUser.id });
    if (!row) throw new Error('temporary staff row not added');
    for (const centre of centres) {
      await tx.insert(staffUserCentre).values({ staffUserId: row.id, centreId: centre });
    }
    return row.id;
  });
  return { id, email, name, secret: await addAuthenticator(email) };
}

/** Signs in with the code from `secret`: through the screens, or directly, as `signIn` does. */
export async function signInWithCode(page: Page, email: string, secret: string) {
  if (!usesTheForm(page)) {
    await signInDirectly(page, email, secret);
    return;
  }
  await page.goto('/app/sign-in');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(seedPassword());
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/app\/two-step/);
  await enterCode(page, secret);
  await expect(page).not.toHaveURL(/\/app\/two-step/);
}

/**
 * Physios land on My day (CLN-01): wait for it, so nothing interrupts the landing,
 * then go on to Home, where the links are.
 */
export async function physioLanded(page: Page, then: string = '/app') {
  await expect(page.getByRole('heading', { name: 'My day', exact: true })).toBeVisible();
  await page.goto(then);
}

/** Ends any support access still on, as a test clean up (IAM-08). */
export async function endSupportAccessForTests() {
  await withActor(testDb(), systemActor('tests'), (tx) =>
    tx
      .update(supportGrant)
      .set({ endsAt: sql`now()` })
      .where(and(lt(supportGrant.startsAt, sql`now()`), gt(supportGrant.endsAt, sql`now()`))),
  );
}

/**
 * Runs `work` while no other test process runs work under the same name: a Postgres advisory
 * lock on its own connection, released when the work ends or the connection closes. For state
 * shared by the phone and desktop projects, such as support access, which is on or off for all.
 */
export async function exclusively<T>(name: string, work: () => Promise<T>): Promise<T> {
  const lock = createDb(required('DIRECT_DATABASE_URL'), { max: 1 });
  try {
    await lock.db.execute(sql`select pg_advisory_lock(hashtext(${name}))`);
    return await work();
  } finally {
    await lock.close();
  }
}
