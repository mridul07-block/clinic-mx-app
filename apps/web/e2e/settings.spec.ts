import { createDb, setting, systemActor, withActor } from '@clinic-mx/db';
import { expect, test } from '@playwright/test';
import { eq } from 'drizzle-orm';
import { exclusively, signInWithCode, temporaryWithCode } from './staff';

// ADM-02 done when: the Super Admin reads and changes each business rule setting, validated and
// audited. Recommended defaults under the user's standing approval (29 October 2026): one setting
// at a time, on the value read; the AI sheet switch, opening entries and AI models keep their own
// flow. Changes only a setting nothing reads yet, and puts it back.

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

const key = 'day.running_late_minutes';
/** Read only when the day before reminders queue their next run (WA-08), and put back after. */
const unused = 'reminders.day_before_time';

/** Someone else saves the setting as it is: its change time moves on. */
async function touchedElsewhere(): Promise<void> {
  await withActor(db(), systemActor('tests'), (tx) =>
    tx.update(setting).set({ updatedAt: new Date() }).where(eq(setting.key, key)),
  );
}

test('the Super Admin changes a setting, checked and on the value read', async ({ page }) => {
  test.slow();
  const admin = await temporaryWithCode('super_admin');
  await signInWithCode(page, admin.email, admin.secret);
  await page.goto('/app');
  await page.getByRole('main').getByRole('link', { name: 'Settings', exact: true }).first().click();
  await expect(page.getByRole('heading', { name: 'Settings', level: 1 })).toBeVisible();
  const fits = () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
  expect(await fits()).toBe(true);

  // Switched on its own page: read only here.
  const gate = page.locator('[data-testid="setting"][data-key="ai.preparation_sheet"]');
  await expect(gate.getByTestId('setting-elsewhere')).toContainText('blind test');
  await expect(gate.getByTestId('setting-form')).toHaveCount(0);

  await exclusively('e2e settings screen', async () => {
    await page.reload();
    const card = page.locator(`[data-testid="setting"][data-key="${key}"]`);
    const now = ((await card.getByTestId('setting-value').textContent()) ?? '').replace(
      'Now: ',
      '',
    );
    await card.getByText('Change', { exact: true }).click();
    const field = card.getByLabel('New value');

    await field.fill('soon');
    await card.getByRole('button', { name: 'Save' }).click();
    await expect(card.getByTestId('setting-error')).toHaveText('Enter a number.');
    await field.fill('-5');
    await card.getByRole('button', { name: 'Save' }).click();
    await expect(card.getByTestId('setting-error')).toContainText('Not a valid value');

    // Changed by someone else since the page was read: refused, never overwritten.
    await touchedElsewhere();
    await field.fill(now);
    await card.getByRole('button', { name: 'Save' }).click();
    await expect(card.getByTestId('setting-error')).toContainText('has changed since you opened');

    // The value already there: nothing written.
    await page.reload();
    await card.getByText('Change', { exact: true }).click();
    await card.getByLabel('New value').fill(now);
    await card.getByRole('button', { name: 'Save' }).click();
    await expect(card.getByText('Nothing to save.')).toBeVisible();

    // A real change, on a setting read only when the next reminder run is queued, put back after.
    const reminder = page.locator(`[data-testid="setting"][data-key="${unused}"]`);
    const was = ((await reminder.getByTestId('setting-value').textContent()) ?? '').replace(
      'Now: ',
      '',
    );
    const changeTo = async (value: string) => {
      await reminder.getByText('Change', { exact: true }).click();
      await reminder.getByLabel('New value').fill(value);
      await reminder.getByRole('button', { name: 'Save' }).click();
      await expect(reminder.getByText('Saved.')).toBeVisible();
      await expect(reminder.getByTestId('setting-value')).toHaveText(`Now: ${value}`);
    };
    await changeTo(was === '17:45' ? '17:30' : '17:45');
    await expect(reminder).toContainText(`by ${admin.name}`);
    await page.reload();
    await changeTo(was);
  });
  await page.screenshot({ path: test.info().outputPath('settings.png') });
});

test('nobody else opens the settings', async ({ page }) => {
  const finance = await temporaryWithCode('finance');
  await signInWithCode(page, finance.email, finance.secret);
  await page.goto('/app/settings');
  await expect(page).toHaveURL(/\/app\/not-allowed/);
});
