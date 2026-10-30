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
import { eq, inArray, or, sql } from 'drizzle-orm';
import { tickUntil } from './jobs';
import { fakeMobile } from './patients';
import { signInWithCode, temporaryWithCode } from './staff';
import { TEST_WHATSAPP_VERIFY_TOKEN, postWebhook, webhookBody } from './whatsapp';

// WA-02 done when: signature verified; acknowledged within seconds; work queued; delivery status
// stored. A test message Meta "took" (made here: tests send nothing) moves to Delivered, then Read,
// through bodies signed with the test app secret; a reply to us shows as Received, by kind and
// never by its text (user decision, 30 October 2026); an unsigned body is refused. Generated
// numbers only; everything made is deleted after.

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

test('statuses from Meta move a sent message on, and a reply to us shows as Received', async ({
  page,
}) => {
  test.slow();
  const to = fakeMobile();
  const from = fakeMobile();
  const outWa = `wamid.e2e-${crypto.randomUUID()}`;
  const inWa = `wamid.e2e-${crypto.randomUUID()}`;
  const replyText = `Private words ${crypto.randomUUID().slice(0, 8)}`;
  const messageId = await withActor(db(), systemActor('tests'), async (tx) => {
    const id = await queueMessage(tx, {
      patientId: null,
      toPhone: to,
      kind: 'test',
      templateKey: 'hello_world',
      templateVersion: 1,
      language: 'en_US',
      variables: {},
      createdBy: 'system:tests',
    });
    await recordMessageOutcome(tx, id, { status: 'sent', waMessageId: outWa });
    return id;
  });
  const statusOf = async () =>
    (await db().select().from(message).where(eq(message.id, messageId)))[0]?.status;
  const status = (value: string) =>
    webhookBody({ statuses: [{ id: outWa, status: value, timestamp: seconds() }] });

  try {
    const admin = await temporaryWithCode('super_admin');
    await signInWithCode(page, admin.email, admin.secret);

    // Unsigned: refused, nothing stored.
    expect((await postWebhook(page.request, status('read'), { signed: false })).status()).toBe(401);

    // Meta's subscribe check repeats the challenge for our token only.
    const check = await page.request.get(
      `/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=${TEST_WHATSAPP_VERIFY_TOKEN}&hub.challenge=8675309`,
    );
    expect(await check.text()).toBe('8675309');

    // Delivered, acknowledged at once and handled within seconds (the tick is only a fallback).
    const delivered = await postWebhook(page.request, status('delivered'));
    expect(delivered.status()).toBe(200);
    await tickUntil(page.request, async () => {
      expect(await statusOf()).toBe('delivered');
    });
    await page.goto('/app/templates');
    const sent = page
      .getByTestId('recent-message')
      .filter({ hasText: to.slice(-4) })
      .first();
    await expect(sent).toHaveAttribute('data-status', 'delivered');
    await expect(sent).toContainText('Delivered');

    // Read, then a late Delivered changes nothing.
    expect((await postWebhook(page.request, status('read'))).status()).toBe(200);
    await tickUntil(page.request, async () => {
      expect(await statusOf()).toBe('read');
    });
    expect((await postWebhook(page.request, status('delivered'))).status()).toBe(200);

    // A reply to us: stored once though Meta sends it twice, shown by kind, never its text.
    const reply = webhookBody({
      messages: [
        {
          from: from.slice(1),
          id: inWa,
          timestamp: seconds(),
          type: 'text',
          text: { body: replyText },
          context: { from: '15556472996', id: outWa },
        },
      ],
    });
    expect((await postWebhook(page.request, reply)).status()).toBe(200);
    expect((await postWebhook(page.request, reply)).status()).toBe(200);
    await tickUntil(page.request, async () => {
      const rows = await db().select().from(message).where(eq(message.waMessageId, inWa));
      expect(rows).toEqual([
        expect.objectContaining({ direction: 'inbound', status: 'received', fromPhone: from }),
      ]);
    });
    expect(await statusOf()).toBe('read');

    await page.reload();
    await expect(sent).toHaveAttribute('data-status', 'read');
    const incoming = page
      .getByTestId('recent-message')
      .filter({ hasText: from.slice(-4) })
      .first();
    await expect(incoming).toHaveAttribute('data-direction', 'inbound');
    await expect(incoming).toContainText('Incoming · Text');
    await expect(incoming).toContainText('Received');
    await expect(page.getByText(replyText)).toHaveCount(0);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await page.screenshot({
      path: test.info().outputPath('whatsapp-webhook.png'),
      fullPage: true,
    });
  } finally {
    // Through this transaction: the test's pool has one connection.
    await withActor(db(), systemActor('tests'), async (tx) => {
      const ids = (
        await tx
          .select({ id: message.id })
          .from(message)
          .where(or(eq(message.id, messageId), eq(message.waMessageId, inWa)))
      ).map((row) => row.id);
      const events = (
        await tx
          .select({ id: whatsappEvent.id })
          .from(whatsappEvent)
          .where(
            or(
              sql`${whatsappEvent.payload}::text like ${`%${outWa}%`}`,
              sql`${whatsappEvent.payload}::text like ${`%${inWa}%`}`,
            ),
          )
      ).map((row) => row.id);
      const keys = [
        ...ids.map((id) => `whatsapp.send:${id}`),
        ...events.map((id) => `whatsapp.event:${id}`),
      ];
      if (keys.length > 0) await tx.delete(job).where(inArray(job.idempotencyKey, keys));
      if (events.length > 0)
        await tx.delete(whatsappEvent).where(inArray(whatsappEvent.id, events));
      if (ids.length > 0) await tx.delete(message).where(inArray(message.id, ids));
    });
  }
});
