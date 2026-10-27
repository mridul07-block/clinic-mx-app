import { formatRupees } from '@clinic-mx/schemas';
import { expect, test } from '@playwright/test';
import { removeCalendarRows } from './calendar';
import { collectedToday, paidToday, removeBills } from './finance';
import { testPatient } from './patients';
import { signInWithCode, temporaryWithCode } from './staff';

// DSH-05 done when: all centres at a glance; AI top 3 accuracy by month. Recommended defaults
// under the user's standing approval (28 October 2026): the Super Admin lands on the Overview; the
// AI's accuracy waits for AI-03 and says so.

const physios: string[] = [];
const bills: string[] = [];
test.afterEach(async () => {
  await removeBills(bills.splice(0));
  if (physios.length) await removeCalendarRows(physios.splice(0));
});

test('the Super Admin lands on the Overview and sees every centre at a glance', async ({
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
  // Every active centre, the week with revenue, the targets and the AI's accuracy to come.
  await expect(page.getByTestId('overview-centre')).not.toHaveCount(0);
  await expect(page.locator('[data-kpi="revenue"]')).toBeVisible();
  await expect(page.getByTestId('outcome-bullet')).toHaveCount(4);
  await expect(page.getByTestId('overview-ai')).toContainText('AI-03');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: test.info().outputPath('overview.png'), fullPage: true });
  await page.getByRole('link', { name: 'Alerts and outcomes' }).click();
  await expect(page).toHaveURL(/\/app\/dashboard\/alerts/);
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
