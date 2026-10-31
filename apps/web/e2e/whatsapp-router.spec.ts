import { createDb, job, message, systemActor, task, withActor, whatsappEvent } from '@clinic-mx/db';
import { expect, test } from '@playwright/test';
import { eq, inArray, or, sql } from 'drizzle-orm';
import { tickUntil } from './jobs';
import { fakeMobile } from './patients';
import { signInWithCode, temporaryWithCode } from './staff';
import { postWebhook, webhookBody } from './whatsapp';

// WA-03 done when: buttons, Flow completions, typed text and emergency phrases each reach the
// right handler. Messages "sent to us" are bodies signed with the test app secret, as Meta would
// send them. Typed text gets the three button menu; "Talk to our team" the front desk details; an
// emergency phrase is routed first and gets the emergency advice (WA-10, emergency.spec.ts). Tests send nothing out: the replies are kept as Not sent. Generated
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

test('typed text, a menu button and an emergency phrase each reach their handler', async ({
  page,
}) => {
  test.slow();
  const from = fakeMobile();
  const waIds: string[] = [];
  const sendToUs = async (message: Record<string, unknown>) => {
    const id = `wamid.e2e-${crypto.randomUUID()}`;
    waIds.push(id);
    const body = webhookBody({
      messages: [{ from: from.slice(1), id, timestamp: seconds(), ...message }],
    });
    expect((await postWebhook(page.request, body)).status()).toBe(200);
    return id;
  };
  const routed = async (wa: string) =>
    (await db().select().from(message).where(eq(message.waMessageId, wa)))[0];
  const replyTo = async (wa: string) =>
    (await db().select().from(message).where(eq(message.contextWaId, wa)))[0];

  try {
    const admin = await temporaryWithCode('super_admin');
    await signInWithCode(page, admin.email, admin.secret);

    const hello = await sendToUs({ type: 'text', text: { body: 'Hi there' } });
    const talk = await sendToUs({
      type: 'interactive',
      interactive: {
        type: 'button_reply',
        button_reply: { id: 'menu.talk', title: 'Talk to our team' },
      },
    });
    const urgent = await sendToUs({
      type: 'text',
      text: { body: 'I have CHEST PAIN, can I book?' },
    });

    await tickUntil(page.request, async () => {
      expect((await routed(hello))?.route).toBe('assistant');
      expect((await routed(talk))?.route).toBe('talk');
      expect((await routed(urgent))?.route).toBe('emergency');
      expect(await replyTo(hello)).toMatchObject({
        kind: 'session',
        templateKey: 'menu',
        toPhone: from,
      });
      expect(await replyTo(talk)).toMatchObject({ kind: 'session', templateKey: 'contact' });
      expect(await replyTo(urgent)).toMatchObject({
        kind: 'session',
        templateKey: 'emergency_advice',
      });
      // One reply each, and tests send nothing out.
      expect((await replyTo(hello))?.status).toBe('skipped');
    });
    const replies = await db().select().from(message).where(eq(message.toPhone, from));
    expect(replies).toHaveLength(3);
    expect(String((await replyTo(talk))?.variables.text)).toMatch(
      /^(To talk to our team, .+\.|Please call the clinic you visit; our front desk will help\.)$/,
    );

    await page.goto('/app/templates');
    const rows = page.getByTestId('recent-message').filter({ hasText: from.slice(-4) });
    await expect(rows.filter({ hasText: 'Incoming · Text → Typed message' })).toHaveCount(1);
    await expect(rows.filter({ hasText: 'Incoming · Reply → Talk to our team' })).toHaveCount(1);
    await expect(rows.filter({ hasText: 'Incoming · Text → Emergency' })).toHaveCount(1);
    await expect(rows.filter({ hasText: 'Reply · Menu' })).toHaveCount(1);
    await expect(rows.filter({ hasText: 'Reply · Contact details' })).toHaveCount(1);
    await expect(rows.filter({ hasText: 'Reply · Emergency advice' })).toHaveCount(1);
    await expect(page.getByText('CHEST PAIN')).toHaveCount(0);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await page.screenshot({
      path: test.info().outputPath('whatsapp-router.png'),
      fullPage: true,
    });
  } finally {
    // Through this transaction: the test's pool has one connection.
    await withActor(db(), systemActor('tests'), async (tx) => {
      const ids = (
        await tx
          .select({ id: message.id })
          .from(message)
          .where(or(eq(message.fromPhone, from), eq(message.toPhone, from)))
      ).map((row) => row.id);
      const events = waIds.length
        ? (
            await tx
              .select({ id: whatsappEvent.id })
              .from(whatsappEvent)
              .where(
                or(...waIds.map((wa) => sql`${whatsappEvent.payload}::text like ${`%${wa}%`}`)),
              )
          ).map((row) => row.id)
        : [];
      const keys = [
        ...ids.flatMap((id) => [`whatsapp.send:${id}`, `whatsapp.route:${id}`]),
        ...events.map((id) => `whatsapp.event:${id}`),
      ];
      if (keys.length > 0) await tx.delete(job).where(inArray(job.idempotencyKey, keys));
      // The emergency's call back task (WA-10) names its message.
      if (ids.length > 0)
        await tx.delete(task).where(sql`${task.details} ->> 'messageId' in ${ids}`);
      if (events.length > 0)
        await tx.delete(whatsappEvent).where(inArray(whatsappEvent.id, events));
      if (ids.length > 0) await tx.delete(message).where(inArray(message.id, ids));
    });
  }
});
