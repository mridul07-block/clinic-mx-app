import { expect, test, type Page } from '@playwright/test';
import {
  clearMail,
  resetLinkFor,
  seedPassword,
  setPassword,
  signIn,
  supabaseUrl,
  testStaff,
} from './staff';

// IAM-01 done when: login works with no browser call to Supabase. Staff sign in, sign out and
// reset their password through our server only; runs on the 360 px phone and on desktop against
// the local Supabase stack.

/** Every URL the page requests, for checking none of them is Supabase. */
function recordRequests(page: Page): string[] {
  const urls: string[] = [];
  page.on('request', (request) => urls.push(request.url()));
  return urls;
}

function expectNoSupabaseCalls(urls: string[]) {
  expect(urls.length).toBeGreaterThan(0);
  const supabase = new URL(supabaseUrl()).origin;
  expect(urls.filter((url) => url.startsWith(supabase) || /supabase\.(co|in)\b/.test(url))).toEqual(
    [],
  );
}

test('signs in and out with no browser call to Supabase', async ({ page, context }) => {
  const urls = recordRequests(page);
  await page.goto('/app');
  await expect(page).toHaveURL(/\/app\/sign-in$/);
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();

  await signIn(page, testStaff.physio.email);
  await expect(page).toHaveURL(/\/app$/);
  await expect(
    page.getByText(`Signed in as ${testStaff.physio.name}, Physiotherapist`),
  ).toBeVisible();

  // The session lives in HTTP only, secure, same site cookies that page scripts cannot read.
  const session = (await context.cookies()).filter((cookie) => cookie.name.startsWith('sb-'));
  expect(session.length).toBeGreaterThan(0);
  for (const cookie of session) {
    expect(cookie).toMatchObject({ httpOnly: true, secure: true, sameSite: 'Lax' });
  }
  expect(await page.evaluate(() => document.cookie)).not.toContain('sb-');

  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/app\/sign-in$/);
  await page.goto('/app');
  await expect(page).toHaveURL(/\/app\/sign-in$/);

  expectNoSupabaseCalls(urls);
});

test('returns to the page that was asked for after signing in', async ({ page }) => {
  await page.goto('/app/test-harness/autosave?id=next-check');
  await expect(page).toHaveURL(/\/app\/sign-in\?next=/);
  await signIn(page, testStaff.finance.email);
  await expect(page).toHaveURL(/\/app\/test-harness\/autosave\?id=next-check$/);
});

test('a signed in person opening sign in goes to the staff app', async ({ page }) => {
  await signIn(page, testStaff.manager.email);
  await page.goto('/app/sign-in');
  await expect(page).toHaveURL(/\/app$/);
});

test('wrong details are refused without saying whether the email has an account', async ({
  page,
}) => {
  await page.goto('/app/sign-in');
  const refusal = page.getByText('That email and password do not match an active staff account.');

  await page.getByLabel('Email').fill(testStaff.physio.email);
  await page.getByLabel('Password', { exact: true }).fill('not the password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(refusal).toBeVisible();
  await expect(page.getByLabel('Email')).toHaveValue(testStaff.physio.email);

  await page.getByLabel('Email').fill('nobody@clinicmx.test');
  await page.getByLabel('Password', { exact: true }).fill('not the password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(refusal).toBeVisible();
  await expect(page).toHaveURL(/\/app\/sign-in$/);
});

test('signing out deletes drafts from the device, after asking if any are unsaved', async ({
  page,
}) => {
  await signIn(page, testStaff.physio.email);
  // A draft the server cannot save: it stays on the device.
  await page.route('**/api/test-harness/notes/**', (route) =>
    route.request().method() === 'PUT' ? route.abort() : route.continue(),
  );
  const noteId = ['sign-out', test.info().project.name].join('-');
  await page.goto(`/app/test-harness/autosave?id=${noteId}`);
  await page.getByLabel('Note text').fill('Not saved before signing out');
  await expect(page.getByText('Not saved yet', { exact: true })).toBeVisible();

  await page.goto('/app');
  await page.getByRole('button', { name: 'Sign out' }).click();
  const warning = page.getByText('1 change is not saved yet.');
  await expect(warning).toBeVisible();
  await page.getByRole('button', { name: 'Stay signed in' }).click();
  await expect(warning).toBeHidden();

  await page.getByRole('button', { name: 'Sign out' }).click();
  await page.getByRole('button', { name: 'Sign out and delete them' }).click();
  await expect(page).toHaveURL(/\/app\/sign-in$/);
  const drafts = await page.evaluate(
    () =>
      new Promise<number>((resolve, reject) => {
        const open = indexedDB.open('clinic-mx-drafts');
        open.onerror = () => {
          reject(new Error('drafts database did not open'));
        };
        open.onsuccess = () => {
          const count = open.result.transaction('drafts').objectStore('drafts').count();
          count.onsuccess = () => {
            resolve(count.result);
          };
        };
      }),
  );
  expect(drafts).toBe(0);
});

test.describe('password reset', () => {
  const account = () =>
    test.info().project.name === 'phone' ? testStaff.resetPhone : testStaff.resetDesktop;

  test.afterEach(async () => {
    await setPassword(account().email, seedPassword());
  });

  test('a reset link from email sets a new password, once', async ({ page }) => {
    const { email } = account();
    const urls = recordRequests(page);
    await clearMail(email);

    await page.goto('/app/sign-in');
    await page.getByRole('link', { name: 'Forgot password?' }).click();
    await page.getByLabel('Email').fill(email);
    await page.getByRole('button', { name: 'Send reset link' }).click();
    await expect(page.getByText(`If ${email} has a staff account`)).toBeVisible();

    const link = await resetLinkFor(email);
    expect(new URL(link).pathname).toBe('/app/reset-password');
    await page.goto(link);
    await expect(page.getByRole('heading', { name: 'Choose a new password' })).toBeVisible();

    const password = page.getByLabel('New password');
    const save = page.getByRole('button', { name: 'Save password' });
    await password.fill('too short');
    await save.click();
    await expect(page.getByText('Use at least 12 characters.')).toBeVisible();

    // The link still works after a refused attempt, even one that reached Supabase.
    await password.fill(seedPassword());
    await save.click();
    await expect(
      page.getByText('That is your current password. Choose a different one.'),
    ).toBeVisible();

    const newPassword = `New-${seedPassword()}-${test.info().project.name}`;
    await password.fill(newPassword);
    await save.click();
    await expect(page).toHaveURL(/\/app\/sign-in\?password=changed$/);
    await expect(page.getByText('Password changed. Sign in with your new password.')).toBeVisible();

    await signIn(page, email, newPassword);
    await expect(page).toHaveURL(/\/app$/);
    expectNoSupabaseCalls(urls);

    // Used once: the same link is refused afterwards.
    await page.getByRole('button', { name: 'Sign out' }).click();
    await page.goto(link);
    await page.getByLabel('New password').fill(`${newPassword}-again`);
    await page.getByRole('button', { name: 'Save password' }).click();
    await expect(page.getByText('This reset link has expired or was already used.')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Ask for a new link' })).toBeVisible();
  });

  test('an email without an account gets the same answer', async ({ page }) => {
    await clearMail('nobody@clinicmx.test');
    await page.goto('/app/forgot-password');
    await page.getByLabel('Email').fill('nobody@clinicmx.test');
    await page.getByRole('button', { name: 'Send reset link' }).click();
    await expect(page.getByText('If nobody@clinicmx.test has a staff account')).toBeVisible();
  });

  test('a link without its token asks for a new one', async ({ page }) => {
    await page.goto('/app/reset-password');
    await expect(
      page.getByText('This reset link is not complete. Ask for a new one.'),
    ).toBeVisible();
  });
});
