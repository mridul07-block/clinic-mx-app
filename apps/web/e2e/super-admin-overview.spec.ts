import { formatRupees } from '@clinic-mx/schemas';
import { expect, test } from '@playwright/test';
import { removeCalendarRows } from './calendar';
import { collectedToday, paidToday, removeBills } from './finance';
import { testPatient } from './patients';
import { signInWithCode, temporaryWithCode } from './staff';

// DSH-05 done when: all centres at a glance; AI top 3 accuracy by month. Recommended defaults
// under the user's standing approval (28 October 2026): the Super Admin lands on the Overview; the
// Targets with no data yet do not show.

const physios: string[] = [];
const bills: string[] = [];
test.afterEach(async () => {
  await removeBills(bills.splice(0));
  if (physios.length) await removeCalendarRows(physios.splice(0));
});

test('the Super Admin lands on Home and sees what needs them and every centre at a glance', async ({
  page,
}) => {
  test.slow();
  const admin = await temporaryWithCode('super_admin');
  const physio = await temporaryWithCode('physiotherapist', ['HSR Layout']);
  physios.push(physio.id);
  bills.push(await paidToday(physio.id, (await testPatient()).id, 98_700));

  await signInWithCode(page, admin.email, admin.secret);
  await expect(page).toHaveURL(/\/app\/overview$/);
  const hsr = page.locator('[data-testid="overview-centre"][data-centre="HSR Layout"]');
  await expect
    .poll(
      async () => {
        await page.reload();
        const shown = (await hsr.getByTestId('overview-collected').textContent()) ?? '';
        const expected = await collectedToday('HSR');
        return expected >= 98_700 && shown === formatRupees(expected);
      },
      { timeout: 20_000 },
    )
    .toBe(true);
  // Every active centre, the week with revenue, on one screen; the rest is on Reports.
  await expect(page.getByTestId('overview-centre')).not.toHaveCount(0);
  await expect(page.locator('[data-kpi="revenue"]')).toBeVisible();
  await expect(page.getByTestId('outcome-bullet')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Needs you now' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Last 7 days' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: test.info().outputPath('overview.png'), fullPage: true });
  // Reports reaches the rest: Money and Figures are its tabs.
  await page.goto('/app/dashboard/centres');
  const tabs = page.getByRole('main').getByRole('navigation', { name: 'Reports' });
  await tabs.getByRole('link', { name: 'Money' }).click();
  await expect(page).toHaveURL(/\/app\/finance\/collections/);
  await page.getByRole('main').getByRole('link', { name: 'Reports' }).click();
  await expect(page).toHaveURL(/\/app\/dashboard\/centres/);
  await tabs.getByRole('link', { name: 'Figures' }).click();
  await expect(page).toHaveURL(/\/app\/figures/);
});

test('Centre Managers and Finance do not open the Overview', async ({ browser }) => {
  for (const role of ['centre_manager', 'finance'] as const) {
    const someone = await temporaryWithCode(role, role === 'centre_manager' ? ['HSR Layout'] : []);
    const context = await browser.newContext();
    const page = await context.newPage();
    await signInWithCode(page, someone.email, someone.secret);
    await page.goto('/app/overview');
    await expect(page).toHaveURL(/\/app\/not-allowed/);
    await context.close();
  }
});
