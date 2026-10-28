import { expect, test, type Page } from '@playwright/test';
import { backToDraft, liveVersion } from './knowledge-base';
import {
  exclusively,
  signIn,
  signInWithCode,
  temporaryDesk,
  temporarySuperAdmin,
  temporaryWithCode,
} from './staff';

// SET-06 done when: the Super Admin approves a version; records store the version used (the
// database tests hold the live version and the records). Here: a Centre Manager reads the
// versions and the import report but cannot approve; the Super Admin confirms they have read the
// report and approves; the front desk cannot open the knowledge base. The approval test holds a
// lock, as the phone and desktop runs approve the same version, and puts it back to a draft.

function noSupabase(page: Page): string[] {
  const requests: string[] = [];
  page.on('request', (request) => {
    if (new URL(request.url()).hostname.endsWith('supabase.co')) requests.push(request.url());
  });
  return requests;
}

test('a Centre Manager reads the versions and the import report, without approving', async ({
  page,
}) => {
  const supabaseRequests = noSupabase(page);
  const version = await liveVersion();
  const manager = await temporaryWithCode('centre_manager', ['HSR Layout']);
  await signInWithCode(page, manager.email, manager.secret);
  await page.goto('/app');
  await page.getByRole('link', { name: 'Knowledge base' }).click();
  await expect(page.getByRole('heading', { name: 'Knowledge base', level: 1 })).toBeVisible();
  const listed = page.getByTestId('kb-version').filter({ hasText: `Version ${version.number}` });
  await expect(listed.getByText('Live', { exact: true })).toBeVisible();

  await listed.getByRole('link').click();
  await expect(
    page.getByRole('heading', { name: `Version ${version.number}`, level: 1 }),
  ).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Import report' })).toBeVisible();
  await expect(page.getByTestId('kb-totals')).toContainText('listings from the workbooks');
  await page.locator('summary', { hasText: /^Workbooks \(\d+\)$/ }).click();
  await expect(page.getByText(/\.xlsx: \d+ rows/).first()).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Approval' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Approve version/ })).toHaveCount(0);
  await expect(page.getByTestId('kb-usage')).toHaveCount(0);
  await page.screenshot({ path: test.info().outputPath('kb-version-manager.png'), fullPage: true });
  expect(supabaseRequests).toEqual([]);
});

test('the Super Admin approves the version once they confirm reading the report', async ({
  page,
}) => {
  const supabaseRequests = noSupabase(page);
  const admin = await temporarySuperAdmin({ support: false });
  await exclusively('e2e knowledge base approval', async () => {
    const version = await liveVersion();
    await backToDraft(version.id);
    try {
      await signInWithCode(page, admin.email, admin.secret);
      await page.goto('/app/knowledge-base');
      await expect(page.getByTestId('kb-bootstrap')).toBeVisible();
      await page
        .getByTestId('kb-version')
        .filter({ hasText: `Version ${version.number}` })
        .getByRole('link')
        .click();
      await expect(page.getByTestId('kb-usage')).toContainText('consultation');
      await expect(page.getByTestId('kb-sign-off')).toContainText('await clinical sign-off');

      const approve = page.getByRole('button', { name: `Approve version ${version.number}` });
      const note = page.getByLabel('Note (optional)');
      await note.fill('Import report read for the e2e test.');
      await approve.click();
      await expect(page.getByRole('alert').filter({ hasText: 'Confirm' })).toHaveText(
        'Confirm you have read the import report.',
      );
      await expect(note).toHaveValue('Import report read for the e2e test.');
      await page.getByLabel(/I have read the import report/).check();
      await page.screenshot({ path: test.info().outputPath('kb-approve.png'), fullPage: true });
      await approve.click();

      await expect(page.getByRole('status').filter({ hasText: 'is approved' })).toContainText(
        `Version ${version.number} is approved.`,
      );
      await expect(page.getByTestId('kb-standing')).toHaveText('Live');
      await expect(page.getByTestId('kb-approved')).toContainText(`by ${admin.name}`);
      await expect(page.getByText('Import report read for the e2e test.')).toBeVisible();
      await expect(page.getByTestId('kb-not-approvable')).toHaveText(
        'This version is approved. An approved version never changes.',
      );
      await expect(approve).toHaveCount(0);
      await page.screenshot({ path: test.info().outputPath('kb-approved.png'), fullPage: true });
      await page.goto('/app/knowledge-base');
      await expect(page.getByTestId('kb-bootstrap')).toHaveCount(0);
      await page.screenshot({ path: test.info().outputPath('kb-list.png'), fullPage: true });
    } finally {
      await backToDraft(version.id);
    }
  });
  expect(supabaseRequests).toEqual([]);
});

test('the front desk cannot open the knowledge base', async ({ page }) => {
  const desk = await temporaryDesk();
  await signIn(page, desk.email);
  await expect(page.getByRole('link', { name: 'Knowledge base' })).toHaveCount(0);
  await page.goto('/app/knowledge-base');
  await expect(page).toHaveURL(/\/app\/not-allowed/);
});
