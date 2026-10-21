import { expect, test } from '@playwright/test';
import {
  endSupportAccessForTests,
  exclusively,
  seedPassword,
  sessionCount,
  signInWithCode,
  temporarySuperAdmin,
} from './staff';

// IAM-08 done when: time limited grant by Super Admin; every action under it logged. Support
// access is on or off for the whole clinic, so the phone and desktop runs take turns. Each run
// has its own Super Admin and Velyx support login, made for it.

test('the Super Admin grants support access for a time; support is read only and logged', async ({
  browser,
  page,
}) => {
  test.setTimeout(180_000);
  const admin = await temporarySuperAdmin({ support: false });
  const support = await temporarySuperAdmin({ support: true });
  // The other person's browser: the same phone or desktop as this project.
  const {
    viewport,
    isMobile,
    hasTouch,
    userAgent,
    deviceScaleFactor,
    baseURL,
    locale,
    timezoneId,
  } = test.info().project.use;
  const options = {
    viewport,
    isMobile,
    hasTouch,
    userAgent,
    deviceScaleFactor,
    baseURL,
    locale,
    timezoneId,
  };

  await exclusively('e2e support access', async () => {
    await endSupportAccessForTests();
    const supportContext = await browser.newContext(options);
    const supportPage = await supportContext.newPage();
    try {
      // Off by default: the support login's right password still does not sign in.
      await supportPage.goto('/app/sign-in');
      await supportPage.getByLabel('Email').fill(support.email);
      await supportPage.getByLabel('Password', { exact: true }).fill(seedPassword());
      await supportPage.getByRole('button', { name: 'Sign in' }).click();
      await expect(
        supportPage.getByText("Support access is off. The clinic's Super Admin can turn it on."),
      ).toBeVisible();
      await expect(supportPage).toHaveURL(/\/app\/sign-in/);

      // The Super Admin turns it on, for whole hours up to the setting, with a reason.
      await signInWithCode(page, admin.email, admin.secret);
      await page.getByRole('link', { name: 'Support access' }).click();
      await expect(page.getByRole('heading', { name: 'Support access' })).toBeVisible();
      await expect(page.getByText('Support access is off.')).toBeVisible();
      await page.getByLabel('Hours').fill('25');
      await page.getByLabel('Reason').fill('Check the staff list for the e2e test');
      await page.getByRole('button', { name: 'Grant support access' }).click();
      await expect(page.getByText('Choose from 1 to 24 hours.')).toBeVisible();
      await page.getByLabel('Hours').fill('1');
      await page.getByRole('button', { name: 'Grant support access' }).click();
      await expect(page.getByText(/^Support access is on until .+ IST\.$/)).toBeVisible();
      await expect(
        page.getByText(/^On until .+ IST, granted by Test Temporary Admin/),
      ).toBeVisible();

      // Support signs in now, read only, told so on every page. The clock is ours from here, so
      // the session check of the open page can be moved on below.
      await supportPage.clock.install();
      await signInWithCode(supportPage, support.email, support.secret);
      await expect(
        supportPage.getByText(/^Velyx support access, read only, until .+ IST\. Everything/),
      ).toBeVisible();
      // The staff list prefetches the pages it links to; a page fetched ahead is not one opened.
      const managerPage = '/app/staff/00000000-0000-4000-8000-000000000203';
      const prefetched = supportPage.waitForRequest((request) =>
        request.url().includes(managerPage),
      );
      await supportPage.goto('/app/staff');
      await expect(supportPage.getByRole('heading', { name: 'Staff' })).toBeVisible();
      await prefetched;
      await expect(supportPage.getByRole('link', { name: 'Invite staff' })).toHaveCount(0);
      await supportPage.getByRole('link').filter({ hasText: admin.name }).click();
      await expect(supportPage.getByText('Velyx support access is read only.')).toBeVisible();
      await expect(supportPage.getByRole('button', { name: /Deactivate/ })).toHaveCount(0);

      // It never reads clinical records, though the Super Admin does without a tick.
      await supportPage.goto('/app/test-harness/permission?action=clinical.read');
      await expect(supportPage).toHaveURL(/\/app\/not-allowed/);

      // A write it tries anyway is refused by the server.
      await supportPage.goto('/app/test-harness/permission?action=staff.manage');
      await supportPage.getByRole('button', { name: 'Try a write' }).click();
      await expect(
        supportPage.getByText('Refused: Velyx support access is read only.'),
      ).toBeVisible();

      // Everything it asked for is on the grant, for the Super Admin.
      await page.reload();
      await page
        .getByText(/^What support opened \(\d+\)$/)
        .first()
        .click();
      const activity = page.getByRole('list', { name: 'Activity under this grant' }).first();
      await expect(activity).toContainText(`${support.name} · /app/staff`);
      await expect(activity).toContainText(
        `${support.name} · Action on /app/test-harness/permission`,
      );
      await expect(activity).not.toContainText(managerPage);

      // Ending it signs support out everywhere; its open page goes to sign in within a minute.
      await supportPage.goto('/app/account');
      await page.getByRole('button', { name: 'End support access now' }).click();
      await expect(
        page.getByText('Support access ended. Velyx support is signed out on every device now.'),
      ).toBeVisible();
      await expect(page.getByText('Support access is off.')).toBeVisible();
      expect(await sessionCount(support.email)).toBe(0);
      await supportPage.clock.fastForward('01:01');
      await expect(supportPage).toHaveURL(/\/app\/sign-in\?reason=ended$/);
    } finally {
      await supportContext.close();
      await endSupportAccessForTests();
    }
  });
});

test('nobody but the Super Admin sees support access', async ({ page }) => {
  await page.goto('/app/sign-in');
  await page.getByLabel('Email').fill('desk.hsr@clinicmx.test');
  await page.getByLabel('Password', { exact: true }).fill(seedPassword());
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).not.toHaveURL(/\/app\/sign-in/);
  await expect(page.getByRole('link', { name: 'Support access' })).toHaveCount(0);
  await page.goto('/app/support-access');
  await expect(page).toHaveURL(/\/app\/not-allowed/);
});
