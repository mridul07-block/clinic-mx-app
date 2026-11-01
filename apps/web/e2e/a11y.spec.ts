import { test } from '@playwright/test';
import { expectAccessible } from './a11y';
import { signIn, testStaff } from './staff';

// UIX-07 done when: axe finds nothing serious or critical on the sign in page and the front
// desk's main screens, at 360 px and on desktop (design system v3 section 11). Each redesigned
// screen adds itself here, or runs expectAccessible in its own spec.

test('the sign in page has no serious accessibility problems', async ({ page }) => {
  await page.goto('/app/sign-in');
  await expectAccessible(page);
});

test("the front desk's Today, Calendar and Patients have no serious accessibility problems", async ({
  page,
}) => {
  await signIn(page, testStaff.desk.email);
  for (const path of ['/app/today', '/app/calendar', '/app/patients']) {
    await page.goto(path);
    await expectAccessible(page);
  }
});
