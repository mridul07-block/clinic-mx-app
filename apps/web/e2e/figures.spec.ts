import { expect, test } from '@playwright/test';
import { removeCalendarRows } from './calendar';
import { consultationsHeldToday, heldConsultation } from './figures';
import { testPatient } from './patients';
import { signInWithCode, temporaryWithCode } from './staff';

// DSH-01 done when: daily figures for every metric in PRD section 9, by centre. Decisions (user,
// 28 October 2026): counted live from the records; the figures without data yet are listed with
// what brings them; the Super Admin's plain table.

const physios: string[] = [];
test.afterEach(async () => {
  if (physios.length) await removeCalendarRows(physios.splice(0));
});

test('the Super Admin reads every figure, overall and by centre, counted from the records', async ({
  page,
}) => {
  const admin = await temporaryWithCode('super_admin');
  const physio = await temporaryWithCode('physiotherapist', ['HSR Layout']);
  physios.push(physio.id);
  await heldConsultation(physio.id, (await testPatient()).id);

  await signInWithCode(page, admin.email, admin.secret);
  await page.goto('/app');
  await page.getByRole('link', { name: 'Figures' }).click();
  await expect(page.getByRole('heading', { name: 'Figures', level: 1 })).toBeVisible();
  // The ten measured, and the eight PRD section 9 figures waiting for their data.
  await expect(page.getByTestId('figures-measured').locator(':scope > li')).toHaveCount(10);
  await expect(page.getByTestId('figures-waiting').locator(':scope > li')).toHaveCount(8);
  await expect(page.locator('[data-figure="nps"]')).toContainText('Waiting for: daily figures');
  await expect(page.locator('[data-figure="consultation_conversion"]')).toContainText(
    'Target: Over 75%',
  );

  // Today's consultations at HSR Layout are the ones held there, ours among them.
  const consultations = page.locator('[data-figure="consultations"]');
  const hsrToday = consultations
    .getByRole('row', { name: /HSR Layout/ })
    .getByRole('cell')
    .first();
  await expect
    .poll(
      async () => {
        await page.reload();
        await consultations.getByText('By centre', { exact: true }).click();
        const shown = Number(await hsrToday.textContent());
        return shown >= 1 && shown === (await consultationsHeldToday('HSR'));
      },
      { timeout: 20_000 },
    )
    .toBe(true);
  // Every table open, money in lakhs included: nothing wider than the screen.
  await page.evaluate(() => {
    for (const details of document.querySelectorAll('details')) details.open = true;
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: test.info().outputPath('figures.png'), fullPage: true });
});

test('Centre Managers and Finance do not open the Super Admin’s figures', async ({ browser }) => {
  for (const role of ['centre_manager', 'finance'] as const) {
    const someone = await temporaryWithCode(role, role === 'centre_manager' ? ['HSR Layout'] : []);
    const context = await browser.newContext();
    const page = await context.newPage();
    await signInWithCode(page, someone.email, someone.secret);
    await page.goto('/app');
    await expect(page.getByRole('link', { name: 'Figures' })).toHaveCount(0);
    await page.goto('/app/figures');
    await expect(page).toHaveURL(/\/app\/not-allowed/);
    await context.close();
  }
});
