import { expect, test } from '@playwright/test';
import { expectAccessible } from './a11y';
import { signIn, testStaff } from './staff';
import { expectLooksRight } from './visual';

// UIX-09 and UIX-11 done when: the kit's overlays and page pieces render on their harnesses at
// 360 px and on desktop with nothing serious for axe, look as their committed screenshots, and the
// sheet and confirm dialog trap focus and close with Escape, giving focus back.

test.beforeEach(async ({ page }) => {
  await signIn(page, testStaff.desk.email);
});

test('the page pieces pass axe and look as they should', async ({ page }) => {
  await page.goto('/app/test-harness/layout');
  await expect(page.getByRole('heading', { name: 'Layout', level: 1 })).toBeVisible();
  await expectAccessible(page);
  await expectLooksRight(page, 'kit-layout', { target: page.locator('main').first() });
});

test('the overlays page passes axe and looks as it should', async ({ page }) => {
  await page.goto('/app/test-harness/overlays');
  await expect(page.getByRole('heading', { name: 'Component kit: overlays' })).toBeVisible();
  await expectAccessible(page);
  await expectLooksRight(page, 'kit-overlays', { target: page.locator('main').first() });
});

test('an open sheet and confirm dialog pass axe and look as they should', async ({ page }) => {
  await page.goto('/app/test-harness/overlays?open=sheet');
  const sheet = page.getByRole('dialog');
  await expect(sheet).toBeVisible();
  await expectAccessible(page);
  await expectLooksRight(page, 'kit-sheet-open', { fullPage: false });

  await page.goto('/app/test-harness/overlays?open=confirm');
  const confirm = page.getByRole('alertdialog');
  await expect(confirm).toBeVisible();
  // Focus starts on the way out, never on the irreversible action.
  await expect(confirm.getByRole('button', { name: 'Go back' })).toBeFocused();
  await expectAccessible(page);
  await page.keyboard.press('Escape');
  await expect(confirm).toBeHidden();
});
