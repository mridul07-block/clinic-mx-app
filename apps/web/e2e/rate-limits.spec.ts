import { expect, test, type Page } from '@playwright/test';
import { openConsentLink } from './part-b';
import { clearSignInLimit, fromNetwork } from './rate-limits';
import { seedPassword, temporaryDesk } from './staff';

// IAM-11 done when: login, patient token and webhook endpoints are limited. The balanced set
// (user decision 22 October 2026): 5 failed sign ins per email, 3 reset emails per email an hour,
// 20 bad patient links per network in 10 minutes, 10 wrong webhook secrets per network a minute.
// Each test comes from a network of its own and uses its own Front Desk member.

const tooMany = /Too many attempts\. Try again in \d+ minutes?\./;

/** One sign in try on the sign in page; stays there on a refusal. */
async function trySignIn(page: Page, email: string, password: string) {
  await page.goto('/app/sign-in');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

const refusal = (page: Page) => page.getByRole('alert').filter({ hasText: /\w/ });

test('five failed sign ins for an email stop the sixth, even with the right password', async ({
  page,
  browser,
}) => {
  await fromNetwork(page);
  const desk = await temporaryDesk();
  for (let attempt = 1; attempt <= 5; attempt++) {
    await trySignIn(page, desk.email, 'not-the-password');
    await expect(refusal(page)).toContainText(
      'That email and password do not match an active staff account.',
    );
  }
  await trySignIn(page, desk.email, seedPassword());
  await expect(refusal(page)).toContainText(tooMany);
  await expect(page).toHaveURL(/\/app\/sign-in/);

  // The limit is the email's: someone else on the same network still signs in.
  const colleague = await temporaryDesk();
  await trySignIn(page, colleague.email, seedPassword());
  await expect(page).toHaveURL(/\/app\/today$/);

  // Once the count is cleared (the runbook's unlock), the right password works.
  await clearSignInLimit(desk.email);
  const fresh = await (await browser.newContext(test.info().project.use)).newPage();
  await fromNetwork(fresh);
  await trySignIn(fresh, desk.email, seedPassword());
  await expect(fresh).toHaveURL(/\/app\/today$/);
  await fresh.context().close();
});

test('signing in clears the email’s failed attempts', async ({ page }) => {
  await fromNetwork(page);
  const desk = await temporaryDesk();
  for (let attempt = 1; attempt <= 4; attempt++) {
    await trySignIn(page, desk.email, 'not-the-password');
  }
  await trySignIn(page, desk.email, seedPassword());
  await expect(page).toHaveURL(/\/app\/today$/);
  await page.context().clearCookies();
  // Four more failures are four, not eight: none is refused for too many.
  for (let attempt = 1; attempt <= 4; attempt++) {
    await trySignIn(page, desk.email, 'not-the-password');
    await expect(refusal(page)).toContainText('do not match an active staff account');
  }
});

test('a network that opens 20 bad patient links waits; other networks do not', async ({
  page,
  browser,
}) => {
  await fromNetwork(page);
  const status = page.getByTestId('patient-link-status');
  for (let attempt = 1; attempt <= 20; attempt++) {
    await page.goto(`/p/${'x'.repeat(attempt)}`);
    await expect(status).toHaveAttribute('data-status', 'invalid');
  }
  const link = await openConsentLink();
  try {
    await page.goto(link.path);
    await expect(page.getByRole('heading', { name: 'Please wait a moment' })).toBeVisible();
    await expect(status).toHaveText('Too many tries. Please wait a few minutes and try again.');
    await expect(status).toHaveAttribute('data-status', 'limited');

    const phone = await (await browser.newContext(test.info().project.use)).newPage();
    await fromNetwork(phone);
    await phone.goto(link.path);
    await expect(
      phone.getByRole('heading', { name: 'Your consent before treatment' }),
    ).toBeVisible();
    await phone.context().close();
  } finally {
    await link.remove();
  }
});

test('the fourth reset email for one email in an hour is refused', async ({ page }) => {
  await fromNetwork(page);
  // No account: Supabase sends nothing (it allows one email a minute per account), yet the
  // limit counts it the same, so the answer says nothing about which emails have accounts.
  const desk = { email: `nobody.${crypto.randomUUID().slice(0, 8)}@clinicmx.test` };
  for (let attempt = 1; attempt <= 3; attempt++) {
    await page.goto('/app/forgot-password');
    await page.getByLabel('Email').fill(desk.email);
    await page.getByRole('button', { name: 'Send reset link' }).click();
    await expect(page.getByText(`If ${desk.email} has a staff account`)).toBeVisible();
  }
  await page.goto('/app/forgot-password');
  await page.getByLabel('Email').fill(desk.email);
  await page.getByRole('button', { name: 'Send reset link' }).click();
  await expect(refusal(page)).toContainText(tooMany);
});

test('ten wrong job tick secrets from a network stop the eleventh call', async ({
  request,
}, testInfo) => {
  const network = `198.51.100.${testInfo.project.name === 'phone' ? 21 : 22}${Math.floor(Math.random() * 9)}`;
  const tick = () =>
    request.post('/api/jobs/tick', {
      headers: { authorization: 'Bearer not-the-secret', 'x-real-ip': network },
    });
  for (let attempt = 1; attempt <= 10; attempt++) {
    expect((await tick()).status()).toBe(401);
  }
  const refused = await tick();
  expect(refused.status()).toBe(429);
  expect(Number(refused.headers()['retry-after'])).toBeGreaterThan(0);
});
