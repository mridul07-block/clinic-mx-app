import { expect, test, type Page } from '@playwright/test';
import { signIn, signInWithCode, temporaryDesk, temporaryWithCode } from './staff';

// SET-10 done when: rules and tiers are configurable; a test for each emergency rule (those are
// unit tests, packages/db/src/knowledge/red-flag-rules.test.ts). Here: clinicians read the rules
// and the workbooks' presentations from the latest knowledge base version (CI imports it after
// seeding); the front desk cannot. Nothing is changed, so nothing needs putting back.

const rule = (page: Page, name: string) =>
  page.getByTestId('red-flag-rule').filter({ has: page.getByText(name, { exact: true }) });

test('a physiotherapist reads the red flag rules and presentations', async ({ page }) => {
  const supabaseRequests: string[] = [];
  page.on('request', (request) => {
    if (new URL(request.url()).hostname.endsWith('supabase.co')) {
      supabaseRequests.push(request.url());
    }
  });
  const physio = await temporaryWithCode('physiotherapist', ['HSR Layout']);
  await signInWithCode(page, physio.email, physio.secret);
  await page.getByRole('link', { name: 'Red flags' }).click();
  await expect(page.getByRole('heading', { name: 'Red flags', level: 1 })).toBeVisible();
  await expect(page.getByTestId('red-flag-version')).toContainText('Knowledge base version');

  const cauda = rule(page, 'Possible cauda equina syndrome (back)');
  await expect(cauda.getByText('Immediate emergency')).toBeVisible();
  await expect(cauda.getByText('Awaiting clinical sign-off')).toBeVisible();
  await expect(cauda).toContainText('Any loss of control of your bowels?');
  await expect(rule(page, 'Unexplained weight loss over the threshold')).toContainText(
    'is at least 5 kg',
  );
  await expect(
    rule(page, 'Recent trauma or accident').getByText('Monitor with caution'),
  ).toBeVisible();

  const lumbar = page.getByTestId('red-flag-region').filter({ hasText: 'Lumbar spine and SIJ' });
  await lumbar.locator('summary').click();
  await expect(lumbar.getByText('CAUDA EQUINA SYNDROME', { exact: true })).toBeVisible();
  await expect(lumbar.getByRole('heading', { name: 'Screening notes' })).toBeVisible();
  expect(supabaseRequests).toEqual([]);
});

test('the front desk cannot open red flags', async ({ page }) => {
  const desk = await temporaryDesk();
  await signIn(page, desk.email);
  await expect(page.getByRole('link', { name: 'Red flags' })).toHaveCount(0);
  await page.goto('/app/red-flags');
  await expect(page).toHaveURL(/\/app\/not-allowed/);
});
