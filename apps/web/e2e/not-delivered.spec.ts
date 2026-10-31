import {
  createDb,
  job,
  message,
  queueMessage,
  recordMessageOutcome,
  systemActor,
  withActor,
  whatsappEvent,
} from '@clinic-mx/db';
import { expect, test } from '@playwright/test';
import { eq, inArray, sql } from 'drizzle-orm';
import { removeCalendarRows, startedAppointment } from './calendar';
import { tickUntil } from './jobs';
import { testPatient } from './patients';
import { signIn, temporaryDesk, temporaryWithCode } from './staff';
import { postWebhook, webhookBody } from './whatsapp';

// WA-13 done when: "Not delivered" shown on the front desk screen. A booking confirmation to a
// patient with an appointment today goes out, then Meta reports through the signed webhook that it
// could not be delivered (131026). The desk's Today shows it with the reason and tags the row;
// Done, once they have called, clears both (user decisions, 31 October 2026). Generated numbers
// and names only; everything made is deleted after.

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

const seconds = () => String(Math.floor(Date.now() / 1000));
const made: string[] = [];
const messages: string[] = [];
const waIds: string[] = [];

test.afterEach(async () => {
  const ids = messages.splice(0);
  const wa = waIds.splice(0);
  await withActor(db(), systemActor('tests'), async (tx) => {
    for (const id of wa) {
      const events = await tx
        .select({ id: whatsappEvent.id })
        .from(whatsappEvent)
        .where(sql`${whatsappEvent.payload}::text like ${`%${id}%`}`);
      for (const event of events) {
        await tx.delete(job).where(eq(job.idempotencyKey, `whatsapp.event:${event.id}`));
        await tx.delete(whatsappEvent).where(eq(whatsappEvent.id, event.id));
      }
    }
    if (ids.length) {
      await tx.delete(job).where(
        inArray(
          job.idempotencyKey,
          ids.map((id) => ['whatsapp.send', id].join(':')),
        ),
      );
      // Its Done goes with it (on delete cascade).
      await tx.delete(message).where(inArray(message.id, ids));
    }
  });
  if (made.length) await removeCalendarRows(made.splice(0));
});

test('a message WhatsApp could not deliver shows on Today until the desk marks it Done', async ({
  page,
}, testInfo) => {
  test.slow();
  const physio = await temporaryWithCode('physiotherapist', ['HSR Layout']);
  made.push(physio.id);
  const patient = await testPatient();
  const visit = await startedAppointment(physio.id, patient.id, -60, { minutes: 30 });
  const wa = `wamid.e2e-${crypto.randomUUID()}`;
  waIds.push(wa);
  const messageId = await withActor(db(), systemActor('tests'), async (tx) => {
    const id = await queueMessage(tx, {
      patientId: patient.id,
      toPhone: patient.phone,
      kind: 'template',
      templateKey: 'booking_confirmation',
      templateVersion: 2,
      language: 'en',
      variables: {},
      createdBy: 'system:tests',
      appointmentId: visit.id,
    });
    await recordMessageOutcome(tx, id, { status: 'sent', waMessageId: wa });
    return id;
  });
  messages.push(messageId);

  // Meta: accepted, then could not deliver it.
  const failed = webhookBody({
    statuses: [
      {
        id: wa,
        status: 'failed',
        timestamp: seconds(),
        errors: [{ code: 131026, title: 'Message undeliverable' }],
      },
    ],
  });
  expect((await postWebhook(page.request, failed)).status()).toBe(200);
  await tickUntil(page.request, async () => {
    const [row] = await db().select().from(message).where(eq(message.id, messageId));
    expect(row).toMatchObject({ status: 'failed', errorCode: '131026' });
  });

  const desk = await temporaryDesk();
  await signIn(page, desk.email);
  await page.goto('/app/today');
  const panel = page.getByTestId('not-delivered');
  const item = panel.getByTestId('not-delivered-item').filter({ hasText: patient.name });
  await expect(item).toHaveCount(1);
  await expect(panel.getByRole('heading', { name: /^Not delivered \(\d+\)$/ })).toBeVisible();
  await expect(item).toContainText('Booking confirmation');
  await expect(item.getByTestId('not-delivered-reason')).toHaveText(
    'Not on WhatsApp, or cannot receive messages',
  );
  await expect(item.getByRole('link', { name: patient.name })).toHaveAttribute(
    'href',
    ['/app/patients', patient.id].join('/'),
  );
  const row = page.getByTestId('today-row').filter({ hasText: patient.name });
  await expect(row.getByTestId('not-delivered-tag')).toHaveText('Not delivered');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: testInfo.outputPath('not-delivered.png') });

  // Called them: Done clears the item and the tag.
  await item.getByRole('button', { name: ['Done: called', patient.name].join(' ') }).click();
  await expect(
    page.getByTestId('not-delivered-item').filter({ hasText: patient.name }),
  ).toHaveCount(0);
  await expect(row.getByTestId('not-delivered-tag')).toHaveCount(0);
  await expect(row).toBeVisible();
});
