import { expect, test } from '@playwright/test';
import { aiSheetOff } from './ai-gate';
import { exclusively, signInWithCode, temporarySuperAdmin, temporaryWithCode } from './staff';

// AI-09 done when: the AI sheet is switched on only after the blind test passes and the legal
// check clears. Here: the Super Admin finds it off, cannot switch it on without the legal
// clearance, switches it on with both records and off again; a Centre Manager cannot open it. The
// switch is shared by the phone and desktop runs, so the test holds a lock and leaves it off.

test('the Super Admin switches the AI preparation sheet on only with both records', async ({
  page,
}) => {
  const supabaseRequests: string[] = [];
  page.on('request', (request) => {
    if (new URL(request.url()).hostname.endsWith('supabase.co')) {
      supabaseRequests.push(request.url());
    }
  });
  const admin = await temporarySuperAdmin({ support: false });
  await exclusively('e2e ai preparation sheet', async () => {
    await aiSheetOff();
    try {
      await signInWithCode(page, admin.email, admin.secret);
      await page.goto('/app');
      await page.getByRole('link', { name: 'AI preparation sheet' }).click();
      await expect(
        page.getByRole('heading', { name: 'AI preparation sheet', level: 1 }),
      ).toBeVisible();
      const status = page.getByTestId('ai-sheet-status');
      await expect(status).toHaveText('Off');

      const blindTest = page.getByRole('group', { name: 'Blind test passed' });
      const legalCheck = page.getByRole('group', { name: 'Legal check cleared' });
      await blindTest.getByLabel('Date').fill('2026-10-20');
      await blindTest.getByLabel('Reference').fill('Blind test report v1');
      await legalCheck.getByLabel('Date').fill('2026-10-21');
      await page.getByRole('button', { name: 'Switch on' }).click();
      await expect(legalCheck.getByText('Enter the document name or number.')).toBeVisible();
      await expect(blindTest.getByLabel('Reference')).toHaveValue('Blind test report v1');
      await expect(status).toHaveText('Off');

      await legalCheck.getByLabel('Reference').fill('Opinion 12/2026');
      await page.screenshot({ path: test.info().outputPath('ai-switch-on.png'), fullPage: true });
      await page.getByRole('button', { name: 'Switch on' }).click();
      await expect(page.getByText('AI preparation sheet switched on.')).toBeVisible();
      await expect(status).toContainText('On since');
      await expect(status).toContainText('for knowledge base version');
      await expect(page.getByTestId('ai-sheet-records')).toContainText('Opinion 12/2026');
      await page.screenshot({ path: test.info().outputPath('ai-sheet-on.png'), fullPage: true });

      await page.getByRole('button', { name: 'Switch off' }).click();
      await expect(page.getByText('AI preparation sheet switched off.')).toBeVisible();
      await expect(status).toHaveText('Off');
      await expect(page.getByRole('button', { name: 'Switch on' })).toBeVisible();
    } finally {
      await aiSheetOff();
    }
  });
  expect(supabaseRequests).toEqual([]);
});

test('a Centre Manager cannot open the AI preparation sheet switch', async ({ page }) => {
  const manager = await temporaryWithCode('centre_manager', ['HSR Layout']);
  await signInWithCode(page, manager.email, manager.secret);
  await page.goto('/app');
  await expect(page.getByRole('link', { name: 'AI preparation sheet' })).toHaveCount(0);
  await page.goto('/app/ai-preparation-sheet');
  await expect(page).toHaveURL(/\/app\/not-allowed/);
});
