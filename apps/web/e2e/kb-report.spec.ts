import { monthLabel } from '@clinic-mx/schemas';
import { expect, test, type Page } from '@playwright/test';
import { farMonth, removeKbReport, seedKbReport } from './kb-report';
import { liveVersion } from './knowledge-base';
import { signInWithCode, temporaryWithCode } from './staff';

// AI-08 done when: often dismissed suggestions, missed diagnoses, changes at review; sent to the
// Super Admin. Recommended defaults (29 October 2026): built on the 1st of each month and kept as
// built; sent as a task to the Super Admin, who reads it under Knowledge base; nobody else does.
// A report is stored as the monthly job stores one (its counts are the database tests').

const months: string[] = [];
test.afterEach(async () => {
  for (const month of months.splice(0)) await removeKbReport(month);
});

const fits = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

test('the Super Admin opens the month’s report from its task, and nobody else reads it', async ({
  page,
  browser,
}) => {
  const month = farMonth();
  months.push(month);
  await seedKbReport(month, await liveVersion());
  const title = `Knowledge base report for ${monthLabel(month, true)}`;

  const admin = await temporaryWithCode('super_admin');
  await signInWithCode(page, admin.email, admin.secret);
  await page.goto('/app/tasks');
  const card = page.getByTestId('task-card').filter({ hasText: title });
  await expect(card).toContainText('Knowledge base report');
  await card.getByRole('link', { name: 'Open the report' }).click();
  await expect(page).toHaveURL(
    (url) => url.pathname === ['/app/knowledge-base/reports', month].join('/'),
  );
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(title);
  await expect(page.getByTestId('kb-report-headline')).toContainText(
    'Right diagnosis in the top 3: 75% of 8',
  );
  await expect(page.getByTestId('kb-report-dismissed-row')).toContainText(
    'Fake Often Dismissed Condition',
  );
  await expect(page.getByTestId('kb-report-dismissed-row')).toContainText('Dismissed 4 of 6 (66%)');
  await expect(page.getByTestId('kb-report-missed-row')).toContainText(
    '1 under Also consider · 1 on the shortlist, not suggested · 0 not on the shortlist · 1 found at recheck',
  );
  await expect(page.getByTestId('kb-report-changed-row')).toContainText(
    'Fake First Impression to Fake Missed Condition · 2',
  );
  await expect(page.getByTestId('kb-report-changed-row')).toContainText('At review');
  expect(await fits(page)).toBe(true);
  await page.screenshot({ path: test.info().outputPath('kb-report.png'), fullPage: true });

  // Listed under Knowledge base, newest first.
  await page.goto('/app/knowledge-base');
  await expect(
    page.getByTestId('kb-report-item').filter({ hasText: monthLabel(month, true) }),
  ).toContainText('75% of 8');

  // A consultant reads the knowledge base, but not the report.
  const consultant = await temporaryWithCode('physiotherapist', ['HSR Layout'], {
    consultant: true,
  });
  const other = await (await browser.newContext()).newPage();
  await signInWithCode(other, consultant.email, consultant.secret);
  await other.goto('/app/knowledge-base');
  await expect(other.getByRole('heading', { name: 'Monthly knowledge base report' })).toBeVisible();
  await expect(other.getByTestId('kb-report-item')).toHaveCount(0);
  const refused = await other.goto(`/app/knowledge-base/reports/${month}`);
  expect(refused?.status()).toBe(404);
  await other.context().close();
});
