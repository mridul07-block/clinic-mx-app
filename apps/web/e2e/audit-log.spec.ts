import { auditEvent, createDb } from '@clinic-mx/db';
import { expect, test, type Page } from '@playwright/test';
import { testEpisode, testPatient } from './patients';
import { signInWithCode, temporaryWithCode } from './staff';

// ADM-01 done when: the Super Admin reads every change, Centre Managers the clinical changes at
// their centres, Finance the money changes. Recommended defaults under the user's standing
// approval (29 October 2026): a clinical record's values only with the Treats patients tick.
// Generated test data only; audit rows are never removed.

let database: ReturnType<typeof createDb> | undefined;
const db = () => {
  const url = process.env.DIRECT_DATABASE_URL;
  if (!url) throw new Error('DIRECT_DATABASE_URL is not set.');
  database ??= createDb(url, { max: 1 });
  return database.db;
};
test.afterAll(async () => {
  await database?.close();
});

const entry = (page: Page, record: string) =>
  page.locator(`[data-testid="audit-entry"][data-record="${record}"]`);
const fits = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

/** A measure changed on the episode, as the audit trigger writes it. */
async function measureChange(episodeId: string, by: string): Promise<string> {
  const measureId = crypto.randomUUID();
  await db()
    .insert(auditEvent)
    .values({
      actor: `staff:${by}`,
      action: 'update',
      entity: 'measure',
      entityId: measureId,
      before: { episode_id: episodeId, value: 'Test 4' },
      after: { episode_id: episodeId, value: 'Test 7' },
    });
  return measureId;
}

test('the Super Admin reads every part, with the values that changed', async ({ page }) => {
  const admin = await temporaryWithCode('super_admin');
  const patient = await testPatient();
  const measureId = await measureChange(await testEpisode(patient.id, 'active'), admin.id);
  await signInWithCode(page, admin.email, admin.secret);
  await page.goto('/app');
  await page.getByRole('link', { name: 'Audit log' }).click();
  await expect(page.getByRole('heading', { name: 'Audit log', level: 1 })).toBeVisible();

  await page.goto('/app/audit?entity=measure');
  const changed = entry(page, measureId);
  await expect(changed).toContainText('Changed: Measure');
  await expect(changed).toContainText(admin.name);
  await expect(changed.getByTestId('audit-changes')).toContainText('Test 4 → Test 7');
  expect(await fits(page)).toBe(true);
  await page.screenshot({ path: test.info().outputPath('audit-admin.png'), fullPage: true });

  // Their own login, among the setup events.
  await page.goto('/app/audit?entity=staff_user');
  await expect(entry(page, admin.id).first()).toBeVisible();

  // Part: Finance shows only money.
  await page.goto('/app/audit');
  await page.getByLabel('Part').selectOption('finance');
  await page.getByRole('button', { name: 'Show' }).click();
  await expect(page).toHaveURL(/part=finance/);
  for (const tag of await page.getByTestId('audit-entry').locator('span.rounded-tag').all()) {
    await expect(tag).toHaveText('Finance');
  }
});

test('a Centre Manager reads clinical events at their centres, a record’s values hidden', async ({
  page,
}) => {
  const manager = await temporaryWithCode('centre_manager', ['HSR Layout']);
  const own = await testPatient();
  const elsewhere = await testPatient({ centreCode: 'WFD' });
  const measureId = await measureChange(await testEpisode(own.id, 'active'), manager.id);
  await signInWithCode(page, manager.email, manager.secret);

  await page.goto('/app/audit?entity=patient');
  await expect(entry(page, own.id).first()).toBeVisible();
  await expect(entry(page, elsewhere.id)).toHaveCount(0);
  // One part: no Part filter; record types are clinical only.
  await expect(page.getByLabel('Part')).toHaveCount(0);
  await expect(page.getByLabel('Record type').locator('option[value="bill"]')).toHaveCount(0);

  await page.goto('/app/audit?entity=measure');
  const changed = entry(page, measureId);
  await expect(changed.getByTestId('audit-hidden')).toContainText('Changed: value.');
  await expect(changed).not.toContainText('Test 7');
  expect(await fits(page)).toBe(true);
  await page.screenshot({ path: test.info().outputPath('audit-manager.png'), fullPage: true });

  // Finance's part and setup tables are not theirs.
  await page.goto('/app/audit?part=finance');
  await expect(page).toHaveURL(/\/app\/not-allowed/);
  await page.goto('/app/audit?entity=staff_user');
  await expect(page).toHaveURL(/\/app\/not-allowed/);
});

test('Finance reads money events only; a physio has no audit log', async ({ page }) => {
  const finance = await temporaryWithCode('finance');
  await signInWithCode(page, finance.email, finance.secret);
  await page.goto('/app/audit');
  await expect(page.getByRole('heading', { name: 'Audit log', level: 1 })).toBeVisible();
  for (const tag of await page.getByTestId('audit-entry').locator('span.rounded-tag').all()) {
    await expect(tag).toHaveText('Finance');
  }
  await page.goto('/app/audit?part=clinical');
  await expect(page).toHaveURL(/\/app\/not-allowed/);

  await page.context().clearCookies();
  const physio = await temporaryWithCode('physiotherapist', ['HSR Layout']);
  await signInWithCode(page, physio.email, physio.secret);
  await page.goto('/app/audit');
  await expect(page).toHaveURL(/\/app\/not-allowed/);
});
