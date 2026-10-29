import { formatRupees } from '@clinic-mx/schemas';
import { expect, test } from '@playwright/test';
import { removeCalendarRows } from './calendar';
import { collectedToday, paidToday, removeBills } from './finance';
import { testPatient } from './patients';
import { signInWithCode, temporaryWithCode } from './staff';

// DSH-04 done when: collections, unpaid, packages, revenue by month and centre; CSV export.
// Recommended defaults under the user's standing approval (28 October 2026): Finance lands on
// Collections; every table downloads as CSV with bill and OP numbers, never a patient's name.

const physios: string[] = [];
const bills: string[] = [];
test.afterEach(async () => {
  await removeBills(bills.splice(0));
  if (physios.length) await removeCalendarRows(physios.splice(0));
});

test('Finance lands on Collections and reads every tab, with CSV downloads', async ({ page }) => {
  test.slow();
  const finance = await temporaryWithCode('finance');
  const physio = await temporaryWithCode('physiotherapist', ['HSR Layout']);
  physios.push(physio.id);
  const patient = await testPatient();
  bills.push(await paidToday(physio.id, patient.id, 123_400));

  await signInWithCode(page, finance.email, finance.secret);
  await expect(page).toHaveURL(/\/app\/finance\/collections/);
  // Today at HSR Layout is what the records say, ours among it.
  const hsr = page.getByTestId('collected-centre').filter({ hasText: 'HSR Layout' });
  await expect
    .poll(
      async () => {
        await page.reload();
        const shown = (await hsr.textContent()) ?? '';
        const expected = await collectedToday('HSR');
        return expected >= 123_400 && shown.includes(formatRupees(expected));
      },
      { timeout: 20_000 },
    )
    .toBe(true);
  const fits = () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
  expect(await fits()).toBe(true);
  await page.screenshot({
    path: test.info().outputPath('finance-collections.png'),
    fullPage: true,
  });

  // The day's collections as CSV: a header, today's UPI at HSR Layout, no patient name.
  const download = page.waitForEvent('download');
  await page.getByTestId('export-collections').click();
  const file = await (await download).path();
  const { readFile } = await import('node:fs/promises');
  const csv = await readFile(file, 'utf8');
  expect(csv.startsWith('Day (IST),Centre,Method,Payments,Rupees\r\n')).toBe(true);
  expect(csv).toContain('HSR Layout,UPI QR');
  expect(csv).not.toContain(patient.name);

  await page.getByRole('link', { name: 'Unpaid', exact: true }).click();
  await expect(page.getByTestId('unpaid-summary')).toBeVisible();
  // BIL-10: pay as you go balances above the unpaid bills.
  await expect(page.getByTestId('balances-summary')).toBeVisible();
  expect(await fits()).toBe(true);
  await page.getByRole('link', { name: 'Packages', exact: true }).click();
  await expect(page.getByTestId('packages-centre')).not.toHaveCount(0);
  expect(await fits()).toBe(true);
  await page.getByRole('link', { name: 'Revenue', exact: true }).click();
  await expect(
    page.getByRole('img', { name: 'Revenue by month against the year before' }),
  ).toBeVisible();
  await page.evaluate(() => {
    for (const details of document.querySelectorAll('details')) details.open = true;
  });
  expect(await fits()).toBe(true);
  await page.screenshot({ path: test.info().outputPath('finance-revenue.png'), fullPage: true });
  const revenue = page.waitForEvent('download');
  await page.getByTestId('export-revenue').click();
  const revenueCsv = await readFile(await (await revenue).path(), 'utf8');
  expect(revenueCsv.split('\r\n')[0]).toBe('Month,Rupees this year,Rupees a year before');
  expect(revenueCsv.split('\r\n').filter(Boolean)).toHaveLength(13);
});

test('Centre Managers and physios get no Finance screen or file', async ({ browser }) => {
  for (const role of ['centre_manager', 'physiotherapist'] as const) {
    const someone = await temporaryWithCode(role, ['HSR Layout']);
    if (role === 'physiotherapist') physios.push(someone.id);
    const context = await browser.newContext();
    const page = await context.newPage();
    await signInWithCode(page, someone.email, someone.secret);
    await page.goto('/app/finance/collections');
    await expect(page).toHaveURL(/\/app\/not-allowed/);
    const file = await page.request.get('/app/finance/export/unpaid');
    expect(file.status()).toBe(403);
    await context.close();
  }
});
