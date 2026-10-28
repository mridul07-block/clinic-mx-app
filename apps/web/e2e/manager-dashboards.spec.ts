import { expect, test } from '@playwright/test';
import { removeCalendarRows } from './calendar';
import { episodesOnHold, heldConsultation, holdEpisode } from './figures';
import { testEpisode, testPatient } from './patients';
import { signInWithCode, temporaryWithCode } from './staff';

// DSH-03 done when: the Centre Manager's alerts, centres, outcomes, team and feedback screens per
// the Frontend Specification. Recommended defaults under the user's standing approval (28 October
// 2026): counts only, at the manager's own centres, never money amounts; the Centre Manager lands
// on Alerts.

const physios: string[] = [];
test.afterEach(async () => {
  if (physios.length) await removeCalendarRows(physios.splice(0));
});

test('a Centre Manager lands on Alerts and reads every tab for their centre', async ({ page }) => {
  test.slow();
  const manager = await temporaryWithCode('centre_manager', ['HSR Layout']);
  const physio = await temporaryWithCode('physiotherapist', ['HSR Layout']);
  physios.push(physio.id);
  await holdEpisode(await testEpisode((await testPatient()).id, 'awaiting_consultation'));
  await heldConsultation(physio.id, (await testPatient()).id);

  await signInWithCode(page, manager.email, manager.secret);
  await expect(page).toHaveURL(/\/app\/dashboard\/alerts/);
  await expect(page.getByRole('link', { name: 'Alerts', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  );
  // The episodes on hold at HSR Layout, as counted from the records.
  const held = page.locator('[data-testid="alert-count"][data-item="episodes_on_hold"]');
  await expect
    .poll(
      async () => {
        await page.reload();
        const shown = Number((await held.locator('.text-title').textContent()) ?? '0');
        return shown >= 1 && shown === (await episodesOnHold('HSR'));
      },
      { timeout: 20_000 },
    )
    .toBe(true);
  await expect(page.getByTestId('alert-coming')).toHaveCount(2);
  const fits = () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
  expect(await fits()).toBe(true);
  await page.screenshot({ path: test.info().outputPath('dashboard-alerts.png'), fullPage: true });

  // Centres: HSR Layout today, the week's cells, no money anywhere.
  await page.getByRole('link', { name: 'Centres', exact: true }).click();
  const hsr = page.locator('[data-testid="centre-today"][data-centre="HSR Layout"]');
  await expect(hsr).toBeVisible();
  await expect(page.getByTestId('centre-today')).toHaveCount(1);
  await expect(page.getByTestId('kpi-panel').locator('[data-kpi]')).toHaveCount(4);
  await expect(page.locator('main')).not.toContainText('₹');
  await page.evaluate(() => {
    for (const details of document.querySelectorAll('details')) details.open = true;
  });
  expect(await fits()).toBe(true);
  await page.screenshot({ path: test.info().outputPath('dashboard-centres.png'), fullPage: true });

  // Outcomes over 12 months: the bullets, the funnel with ours in it.
  await page.getByRole('link', { name: 'Outcomes', exact: true }).click();
  await page.getByRole('link', { name: 'Last 12 months' }).click();
  await expect(page).toHaveURL(/window=365/);
  await expect(page.getByTestId('outcome-bullet')).toHaveCount(4);
  await expect(page.locator('[data-figure="reinjury"]')).toContainText('Not measured yet');
  await expect(page.getByTestId('funnel-stage')).toHaveCount(5);
  expect(await fits()).toBe(true);
  await page.screenshot({ path: test.info().outputPath('dashboard-outcomes.png'), fullPage: true });

  await page.getByRole('link', { name: 'Team', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Rosters and leave' })).toBeVisible();
  await page.getByRole('link', { name: 'Feedback', exact: true }).click();
  // Empty, or the HSR answers other tests left (PAT-04 has its own spec).
  await expect(page.getByRole('heading', { name: 'After the consultation' })).toBeVisible();
  await expect(page.locator('main')).toContainText('PAT-07');
  expect(await fits()).toBe(true);
});

test('Finance and physios do not open the dashboard', async ({ browser }) => {
  for (const role of ['finance', 'physiotherapist'] as const) {
    const someone = await temporaryWithCode(role, role === 'physiotherapist' ? ['HSR Layout'] : []);
    if (role === 'physiotherapist') physios.push(someone.id);
    const context = await browser.newContext();
    const page = await context.newPage();
    await signInWithCode(page, someone.email, someone.secret);
    await page.goto('/app/dashboard/centres');
    await expect(page).toHaveURL(/\/app\/not-allowed/);
    await context.close();
  }
});
