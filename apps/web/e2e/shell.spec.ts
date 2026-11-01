import { expect, test } from '@playwright/test';
import { expectAccessible } from './a11y';
import { signIn, testStaff } from './staff';

// UIX-12 done when: a phone reaches search, notifications and the person menu (Account, Sign out)
// from the top bar of every screen, without going through More; on desktop the rail or sidebar
// keeps them and the top bar keeps notifications. Nothing serious for axe on either.

test('the phone top bar opens search, notifications and the person menu', async ({ page }) => {
  test.skip(test.info().project.name !== 'phone', 'the top bar controls are for phones');
  await signIn(page, testStaff.desk.email);
  await page.goto('/app/today');
  const bar = page.getByTestId('top-bar');
  await expect(bar).toBeVisible();

  await bar.getByRole('button', { name: 'Search screens and patients' }).click();
  const search = page.getByRole('dialog', { name: 'Search or jump to' });
  await expect(search).toBeVisible();
  await search.getByRole('combobox', { name: 'Search or jump to' }).fill('Calendar');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/app\/calendar/);

  await bar.getByTestId('top-person-menu').locator('summary').click();
  const menu = bar.getByTestId('top-person-menu');
  await expect(menu.getByRole('link', { name: 'Account' })).toBeVisible();
  await expect(menu.getByRole('button', { name: 'Sign out' })).toBeVisible();
  await menu.getByRole('link', { name: 'Account' }).click();
  await expect(page).toHaveURL(/\/app\/account$/);

  await bar.getByRole('link', { name: /^Notifications/ }).click();
  await expect(page).toHaveURL(/\/app\/notifications$/);
  await expectAccessible(page);
});

test('on desktop the top bar keeps notifications and the sidebar the rest', async ({ page }) => {
  test.skip(test.info().project.name !== 'desktop', 'the sidebar is for desktops');
  await signIn(page, testStaff.desk.email);
  await page.goto('/app/today');
  const bar = page.getByTestId('top-bar');
  await expect(bar.getByRole('link', { name: /^Notifications/ })).toBeVisible();
  await expect(bar.getByTestId('top-search')).toBeHidden();
  await expect(bar.getByTestId('top-person-menu')).toBeHidden();
  await expect(page.getByTestId('side-nav').getByTestId('person-menu')).toBeVisible();
  await expectAccessible(page);
});
