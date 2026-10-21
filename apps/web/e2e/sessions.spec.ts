import { expect, test, type BrowserContext } from '@playwright/test';
import { deactivateAsSuperAdmin, sessionCount, signIn, temporaryDesk, testStaff } from './staff';

// IAM-07 done when: 15 minute idle logout on desktop; phone sessions persist; deactivation
// revokes at once. The desktop project is a desktop (fine pointer, 1440 px) and the phone
// project a phone (touch, 360 px), as decided at sign in (G7). Front Desk logins need no code.

const isPhone = () => test.info().project.name === 'phone';
const minutes = (n: number) => n * 60_000;

/** Pretends the desktop's last activity the server knows of was `ago` ms ago. */
async function lastSeenAgo(context: BrowserContext, ago: number) {
  await context.addCookies([
    {
      name: 'clinic_last_seen',
      value: String(Date.now() - ago),
      domain: 'localhost',
      path: '/',
      httpOnly: true,
      secure: true,
      sameSite: 'Lax',
    },
  ]);
}

/** The device class the sign in decided (G7). */
const deviceCookie = async (context: BrowserContext) =>
  (await context.cookies()).find((cookie) => cookie.name === 'clinic_device')?.value;

test.describe('on a desktop', () => {
  test.skip(isPhone, 'desktop rules');

  test('a session idle for more than 15 minutes is signed out on the next page', async ({
    page,
    context,
  }) => {
    const person = await temporaryDesk();
    await signIn(page, person.email);
    expect(await deviceCookie(context)).toBe('desktop');
    await lastSeenAgo(context, minutes(16));
    await page.goto('/app/account');
    await expect(page).toHaveURL(/\/app\/sign-in\?reason=idle&next=%2Fapp%2Faccount/);
    await expect(
      page.getByText('You were signed out after 15 minutes without activity.'),
    ).toBeVisible();
    // The session is gone, not only hidden.
    await page.goto('/app');
    await expect(page).toHaveURL(/\/app\/sign-in$/);
    expect(await sessionCount(person.email)).toBe(0);
  });

  test('activity within the 15 minutes keeps the session', async ({ page, context }) => {
    const person = await temporaryDesk();
    await signIn(page, person.email);
    await lastSeenAgo(context, minutes(14));
    await page.goto('/app/account');
    await expect(page.getByRole('heading', { name: 'Account' })).toBeVisible();
  });

  test('an open page warns a minute before, and signs out after 15 idle minutes', async ({
    page,
  }) => {
    const person = await temporaryDesk();
    await page.clock.install();
    await signIn(page, person.email);
    await page.goto('/app/account');
    await expect(page.getByRole('heading', { name: 'Account' })).toBeVisible();

    await page.clock.fastForward('14:00');
    const warning = page.getByRole('alert').filter({ hasText: 'You will be signed out in' });
    await expect(warning).toContainText('60 seconds');
    await page.getByRole('button', { name: 'Stay signed in' }).click();
    await expect(warning).toHaveCount(0);

    await page.clock.fastForward('14:00');
    await expect(warning).toBeVisible();
    await page.clock.fastForward('01:01');
    await expect(page).toHaveURL(/\/app\/sign-in\?reason=idle$/);
    await expect(
      page.getByText('You were signed out after 15 minutes without activity.'),
    ).toBeVisible();
  });
});

test.describe('on a phone', () => {
  test.skip(() => !isPhone(), 'phone rules');

  test('a session stays signed in however long it was idle', async ({ page, context }) => {
    await signIn(page, testStaff.desk.email);
    expect(await deviceCookie(context)).toBe('phone');
    await lastSeenAgo(context, minutes(60 * 24 * 3));
    await page.goto('/app/account');
    await expect(page.getByRole('heading', { name: 'Account' })).toBeVisible();
  });
});

test('deactivation ends the sessions and sends an open page to sign in within a minute', async ({
  page,
}) => {
  const person = await temporaryDesk();
  await page.clock.install();
  await signIn(page, person.email);
  await page.goto('/app/account');
  await expect(page.getByRole('heading', { name: 'Account' })).toBeVisible();
  expect(await sessionCount(person.email)).toBeGreaterThan(0);

  expect(await deactivateAsSuperAdmin(person.id)).toBeGreaterThan(0);
  expect(await sessionCount(person.email)).toBe(0);

  await page.clock.fastForward('01:01');
  await expect(page).toHaveURL(/\/app\/sign-in\?reason=ended$/);
  await expect(page.getByText('Your session ended. Sign in again to go on.')).toBeVisible();
});
