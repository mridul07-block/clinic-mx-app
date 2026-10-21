import { expect, test } from '@playwright/test';
import { signIn, testStaff } from './staff';

// IAM-04: pages are guarded by the permission map. The harness page (on only in the Playwright
// web server) is guarded by the action in its address; Front Desk may manage bookings but not
// staff. On the 360 px phone and desktop.
const harness = (action: string) => `/app/test-harness/permission?action=${action}`;

test.beforeEach(async ({ page }) => {
  await signIn(page, testStaff.desk.email);
});

test('lets a role use a page its permissions include', async ({ page }) => {
  await page.goto(harness('bookings.manage'));
  await expect(page.getByRole('heading', { name: 'Allowed' })).toBeVisible();
  await expect(page.getByText(`${testStaff.desk.name} may use bookings.manage.`)).toBeVisible();
});

test('sends a role to the not allowed page for a page its permissions leave out', async ({
  page,
}) => {
  await page.goto(harness('staff.manage'));
  await expect(page).toHaveURL(/\/app\/not-allowed$/);
  await expect(
    page.getByRole('heading', { name: 'You do not have access to this page' }),
  ).toBeVisible();
  await page.getByRole('link', { name: 'Go to home' }).click();
  await expect(page).toHaveURL(/\/app$/);
  await expect(page.getByText(`Signed in as ${testStaff.desk.name}`)).toBeVisible();
});

test('refuses clinical pages to Front Desk', async ({ page }) => {
  for (const action of ['clinical.read', 'session_notes.write', 'consultant_records.sign']) {
    await page.goto(harness(action));
    await expect(page).toHaveURL(/\/app\/not-allowed$/);
  }
});
