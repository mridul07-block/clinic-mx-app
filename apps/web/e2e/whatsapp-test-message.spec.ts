import { createDb, job, message, setting, systemActor, withActor } from '@clinic-mx/db';
import { expect, test } from '@playwright/test';
import { eq, inArray } from 'drizzle-orm';
import { tickUntil } from './jobs';
import { fakeMobile } from './patients';
import { exclusively, signIn, signInWithCode, temporaryDesk, temporaryWithCode } from './staff';

// WA-01 done when: messages send with retries; message rows stored. Decisions (user, 30 October
// 2026): only numbers on the test list receive anything while it is on; the Super Admin proves the
// connection with Meta's "hello_world" sample. Tests have no WhatsApp configured, so nothing ever
// leaves: the message is kept as Not sent, "not configured". The test list is put back after.

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

const listKey = 'whatsapp.test_recipients';

async function messagesTo(to: string) {
  return db()
    .select({ id: message.id, status: message.status, errorCode: message.errorCode })
    .from(message)
    .where(eq(message.toPhone, to));
}

test('the Super Admin adds a test number and sends it a test message, kept as Not sent here', async ({
  page,
}) => {
  test.slow();
  const number = fakeMobile();
  const admin = await temporaryWithCode('super_admin');
  await signInWithCode(page, admin.email, admin.secret);
  await exclusively('e2e whatsapp test recipients', async () => {
    const [before] = await db().select().from(setting).where(eq(setting.key, listKey));
    try {
      // On the Settings screen, as the runbook tells the Super Admin.
      await page.goto('/app/settings');
      const card = page.locator(`[data-testid="setting"][data-key="${listKey}"]`);
      await card.getByText('Change', { exact: true }).click();
      await card.getByLabel('New value').fill(JSON.stringify([number]));
      await card.getByRole('button', { name: 'Save' }).click();
      await expect(card.getByText('Saved.')).toBeVisible();

      await page.goto('/app/templates');
      const fits = () =>
        page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
      expect(await fits()).toBe(true);
      await page.getByLabel('Send to').selectOption(number);
      await page.getByRole('button', { name: 'Send test message' }).click();
      await expect(page.getByText('Queued. It goes within a minute.')).toBeVisible();

      await tickUntil(page.request, async () => {
        expect(await messagesTo(number)).toEqual([
          expect.objectContaining({ status: 'skipped', errorCode: 'not_configured' }),
        ]);
      });
      await page.reload();
      const sent = page
        .getByTestId('recent-message')
        .filter({ hasText: number.slice(-4) })
        .first();
      await expect(sent).toHaveAttribute('data-status', 'skipped');
      await expect(sent).toContainText('Test message');
      await expect(sent.getByTestId('message-reason')).toHaveText(
        'WhatsApp is not configured on this server.',
      );
      await page.screenshot({
        path: test.info().outputPath('whatsapp-test-message.png'),
        fullPage: true,
      });
    } finally {
      await withActor(db(), systemActor('tests'), async (tx) => {
        if (before) {
          await tx.update(setting).set({ value: before.value }).where(eq(setting.key, listKey));
        }
        // Through this transaction: the test's pool has one connection.
        const ids = (
          await tx.select({ id: message.id }).from(message).where(eq(message.toPhone, number))
        ).map((row) => row.id);
        if (ids.length > 0) {
          await tx.delete(job).where(
            inArray(
              job.idempotencyKey,
              ids.map((id) => `whatsapp.send:${id}`),
            ),
          );
          await tx.delete(message).where(inArray(message.id, ids));
        }
      });
    }
  });
});

test('the Super Admin sees the test message and recent messages; the desk has no page', async ({
  page,
}) => {
  const admin = await temporaryWithCode('super_admin');
  await signInWithCode(page, admin.email, admin.secret);
  await page.goto('/app/templates');
  await expect(page.getByRole('heading', { name: 'Test message' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Recent messages' })).toBeVisible();

  const desk = await temporaryDesk();
  await page.context().clearCookies();
  await signIn(page, desk.email);
  await page.goto('/app/templates');
  await expect(page).toHaveURL(/\/app\/not-allowed/);
});
