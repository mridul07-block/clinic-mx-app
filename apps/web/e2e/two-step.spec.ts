import { expect, test, type Page } from '@playwright/test';
import {
  addAuthenticator,
  clearMail,
  clearTwoStep,
  enterCode,
  resetLinkFor,
  seedPassword,
  setPassword,
  setupStaff,
  supabaseUrl,
  testStaff,
} from './staff';
import { totpCode } from './totp';

// IAM-02 done when: two step verification is required for all roles except Front Desk. Codes
// come from an authenticator app (TOTP), checked by our server only; 360 px phone and desktop.

const account = setupStaff;

async function signInWithPassword(page: Page, email: string) {
  await page.goto('/app/sign-in');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(seedPassword());
  await page.getByRole('button', { name: 'Sign in' }).click();
}

test.beforeEach(async () => {
  await clearTwoStep(account().email);
});

test('a role that requires it sets up an authenticator app at first sign in', async ({ page }) => {
  const { email, name } = account();
  const urls: string[] = [];
  page.on('request', (request) => urls.push(request.url()));

  // Asked for on the way to a page, kept through setup.
  await page.goto('/app/account');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(seedPassword());
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/app\/two-step\/setup\?next=%2Fapp%2Faccount$/);
  await expect(page.getByRole('heading', { name: 'Set up two step verification' })).toBeVisible();
  await expect(page.getByText('Your role needs a code from an authenticator app')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Add to authenticator app' })).toHaveAttribute(
    'href',
    /^otpauth:\/\/totp\//,
  );
  await expect(page.getByAltText(/QR code/)).toBeVisible();

  const secret = (await page.getByTestId('two-step-key').innerText()).replace(/\s/g, '');
  await page.getByLabel('6 digit code').fill('123');
  await page.getByRole('button', { name: 'Turn on two step verification' }).click();
  await expect(page.getByText('Enter the 6 digit code from your authenticator app.')).toBeVisible();

  await page.getByLabel('6 digit code').fill(totpCode(secret));
  await page.getByRole('button', { name: 'Turn on two step verification' }).click();
  await expect(page).toHaveURL(/\/app\/account$/);
  await expect(page.getByText(`${name}, Physiotherapist`)).toBeVisible();
  await expect(
    page.getByText('On. Each sign in needs a code from your authenticator app'),
  ).toBeVisible();

  // The next sign in asks for a code; a wrong one is refused.
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/app\/sign-in$/);
  await signInWithPassword(page, email);
  await expect(page).toHaveURL(/\/app\/two-step$/);
  await page.getByLabel('6 digit code').fill(totpCode(secret, Date.now() - 10 * 60_000));
  await page.getByRole('button', { name: 'Verify' }).click();
  await expect(page.getByText('That code did not work.')).toBeVisible();
  await enterCode(page, secret);
  // A physiotherapist lands on My patients today (CLN-01).
  await expect(page).toHaveURL(/\/app\/my-patients$/);
  await expect(page.getByText(`Signed in as ${name}`)).toBeVisible();

  // The QR code is drawn in the page: the browser still never called Supabase.
  const supabase = new URL(supabaseUrl()).origin;
  expect(urls.filter((url) => url.startsWith(supabase) || /supabase\.(co|in)\b/.test(url))).toEqual(
    [],
  );
});

test('staff pages stay closed until the code is entered', async ({ page }) => {
  await addAuthenticator(account().email);
  await signInWithPassword(page, account().email);
  await expect(page).toHaveURL(/\/app\/two-step$/);

  await page.goto('/app');
  await expect(page).toHaveURL(/\/app\/two-step$/);
  await page.goto('/app/account');
  await expect(page).toHaveURL(/\/app\/two-step\?next=%2Fapp%2Faccount$/);
  await page.goto('/app/test-harness/autosave?id=closed');
  await expect(page).toHaveURL(/\/app\/two-step\?next=/);

  // Leaving part way through signs out.
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/app\/sign-in$/);
  await page.goto('/app');
  await expect(page).toHaveURL(/\/app\/sign-in$/);
});

test('a role that requires it cannot skip setup', async ({ page }) => {
  await signInWithPassword(page, account().email);
  await expect(page).toHaveURL(/\/app\/two-step\/setup$/);
  await page.goto('/app');
  await expect(page).toHaveURL(/\/app\/two-step\/setup$/);
  await page.goto('/app/two-step');
  await expect(page).toHaveURL(/\/app\/two-step\/setup$/);
});

test('Front Desk signs in with the password alone', async ({ page }) => {
  await signInWithPassword(page, testStaff.desk.email);
  // The Front Desk lands on Today (INT-01); Account is on Home.
  await expect(page).toHaveURL(/\/app\/today$/);
  await expect(page.getByText(`Signed in as ${testStaff.desk.name}, Front Desk`)).toBeVisible();
  await page.getByRole('link', { name: 'Home' }).click();
  await page.getByRole('main').getByRole('link', { name: 'Account' }).click();
  await expect(page.getByText('Off. Turn it on')).toBeVisible();
});

test('a password reset also needs the authenticator code', async ({ page }) => {
  const { email } = account();
  const secret = await addAuthenticator(email);
  await clearMail(email);
  await page.goto('/app/forgot-password');
  await page.getByLabel('Email').fill(email);
  await page.getByRole('button', { name: 'Send reset link' }).click();
  await page.goto(await resetLinkFor(email));

  const newPassword = `New-${seedPassword()}-${test.info().project.name}`;
  await page.getByLabel('New password').fill(newPassword);
  await page.getByRole('button', { name: 'Save password' }).click();
  await expect(page.getByText('Your account has two step verification.')).toBeVisible();

  await page.getByLabel('New password').fill(newPassword);
  await page.getByLabel('Code from your authenticator app').fill(totpCode(secret));
  await page.getByRole('button', { name: 'Save password' }).click();
  await expect(page).toHaveURL(/\/app\/sign-in\?password=changed$/);
  await setPassword(email, seedPassword());
});
