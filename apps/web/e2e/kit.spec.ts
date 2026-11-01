import { expect, test } from '@playwright/test';
import { expectAccessible } from './a11y';
import { signIn, testStaff } from './staff';
import { expectLooksRight } from './visual';

// UIX-08 done when: the kit's form controls (packages/ui/src/components) render on the harness
// at 360 px and on desktop with nothing serious for axe and look as their committed screenshots.
// They are native inputs with their names, so they post in a plain form (the unit tests check
// each one's markup). The harness holds made up labels only.

test('the form controls pass axe and look as they should', async ({ page }) => {
  await signIn(page, testStaff.desk.email);
  await page.goto('/app/test-harness/kit');
  await expect(page.getByRole('heading', { name: 'Component kit: form controls' })).toBeVisible();
  await expectAccessible(page);
  await expectLooksRight(page, 'kit-form-controls', { target: page.locator('main').first() });
});

test('a touch screen gets 44 px controls and 16 px fields', async ({ page }) => {
  test.skip(test.info().project.name !== 'phone', 'touch sizes apply on the phone project');
  await signIn(page, testStaff.desk.email);
  await page.goto('/app/test-harness/kit');
  const email = page.locator('input[name="email"]');
  await expect(email).toHaveCSS('font-size', '16px');
  await expect
    .poll(() => email.evaluate((el) => el.getBoundingClientRect().height))
    .toBeGreaterThanOrEqual(44);
});

// UIX-10 done when: a date is typed as day, month and year (the Indian order) or picked from the
// calendar, and the form receives it as an ISO date, on a phone and with a keyboard.
test('a date typed or picked posts as an ISO date', async ({ page }) => {
  await signIn(page, testStaff.desk.email);
  await page.goto('/app/test-harness/kit');
  // React Aria also renders a native date input with form="", which belongs to no form and never
  // posts; the hidden text input is what the form sends.
  const posted = page.locator('input[name="visitDateError"]:not([type="date"])');

  await page.getByRole('spinbutton', { name: /^day, Visit date with an error/ }).click();
  await page.keyboard.type('25122026');
  await expect(posted).toHaveValue('2026-12-25');

  // The calendar: next month, then the 5th.
  await page
    .getByRole('group', { name: 'Visit date with an error' })
    .getByRole('button', { name: 'Choose from a calendar' })
    .click();
  const calendar = page.getByRole('dialog', { name: 'Visit date with an error' });
  await calendar.getByRole('button', { name: 'Next month' }).click();
  await calendar.getByRole('button', { name: 'Tuesday, 5 January 2027', exact: true }).click();
  await expect(posted).toHaveValue('2027-01-05');
});
