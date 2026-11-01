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
  const email = page.getByLabel('Email', { exact: true });
  expect(await email.evaluate((el) => getComputedStyle(el).fontSize)).toBe('16px');
  expect((await email.boundingBox())?.height).toBeGreaterThanOrEqual(44);
});
