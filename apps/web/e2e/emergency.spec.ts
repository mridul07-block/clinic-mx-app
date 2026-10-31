import { createDb, job, message, systemActor, task, withActor, whatsappEvent } from '@clinic-mx/db';
import { formatIndianPhone } from '@clinic-mx/schemas';
import { expect, test } from '@playwright/test';
import { and, eq, inArray, or, sql } from 'drizzle-orm';
import { tickUntil } from './jobs';
import { fakeMobile } from './patients';
import { signIn, temporaryDesk } from './staff';
import { postWebhook, webhookBody } from './whatsapp';

// WA-10 done when: emergency advice plus the clinic number; an urgent front desk task. A message
// with an emergency phrase comes in through the signed webhook as Meta sends it, from a number not
// on file: it gets the advice with every centre's phone, never the menu or a booking, and the front
// desk gets one urgent task with the number to call back, however many such messages follow (user
// decisions, 31 October 2026). Generated numbers only; everything made is deleted after.

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

test('an emergency phrase gets the advice and the front desk an urgent call back task', async ({
  page,
}) => {
  test.slow();
  const from = fakeMobile();
  const waIds: string[] = [];
  const sendToUs = async (body: string) => {
    const id = `wamid.e2e-${crypto.randomUUID()}`;
    waIds.push(id);
    const signed = webhookBody({
      messages: [{ from: from.slice(1), id, timestamp: seconds(), type: 'text', text: { body } }],
    });
    expect((await postWebhook(page.request, signed)).status()).toBe(200);
    return id;
  };
  const replyTo = async (wa: string) =>
    (await db().select().from(message).where(eq(message.contextWaId, wa)))[0];
  const tasksOf = async () => {
    const ids = (
      await db().select({ id: message.id }).from(message).where(eq(message.fromPhone, from))
    ).map((row) => row.id);
    return ids.length
      ? db()
          .select()
          .from(task)
          .where(
            and(eq(task.kind, 'call.emergency'), sql`${task.details} ->> 'messageId' in ${ids}`),
          )
      : [];
  };

  try {
    const first = await sendToUs('Please help, my father has chest pain');
    await tickUntil(page.request, async () => {
      const reply = await replyTo(first);
      expect(reply).toMatchObject({
        kind: 'session',
        templateKey: 'emergency_advice',
        toPhone: from,
      });
      const text = String(reply?.variables.text);
      expect(text).toMatch(
        /^If this is a medical emergency, call 112 or go to the nearest hospital emergency department now\. Do not wait for a reply here\./,
      );
      expect(text).toMatch(/To reach the clinic, call HSR Layout \+91 [\d ]+/);
      expect(await tasksOf()).toHaveLength(1);
    });
    const [raised] = await tasksOf();
    expect(raised).toMatchObject({
      priority: 'urgent',
      assigneeRole: 'front_desk',
      centreId: null,
      patientId: null,
      status: 'open',
    });

    // Another message from the number: the advice again, but no second task.
    const second = await sendToUs('CHEST PAIN still');
    await tickUntil(page.request, async () => {
      expect((await replyTo(second))?.templateKey).toBe('emergency_advice');
    });
    expect(await tasksOf()).toHaveLength(1);
    // Nothing but the advice: no menu, no booking form.
    const replies = await db().select().from(message).where(eq(message.toPhone, from));
    expect(replies.map((reply) => reply.templateKey)).toEqual([
      'emergency_advice',
      'emergency_advice',
    ]);

    // The front desk sees it first, Urgent, with the number to call.
    const desk = await temporaryDesk();
    await signIn(page, desk.email);
    await page.goto('/app/tasks');
    const card = page
      .getByTestId('task-card')
      .filter({ has: page.getByRole('link', { name: `Call ${formatIndianPhone(from)}` }) });
    await expect(card).toHaveCount(1);
    await expect(card).toContainText('Emergency message on WhatsApp: call back now');
    await expect(card).toContainText('Urgent');
    await expect(card).toContainText('Call back: emergency message on WhatsApp');
    await expect(card.getByTestId('call-back')).toHaveAttribute('href', `tel:${from}`);
    await expect(card.getByRole('button', { name: 'Take it' })).toBeVisible();
    // The message itself is never shown.
    await expect(page.getByText('chest pain', { exact: false })).toHaveCount(0);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await card.scrollIntoViewIfNeeded();
    await page.screenshot({ path: test.info().outputPath('emergency-task.png') });
  } finally {
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
      if (ids.length > 0)
        await tx.delete(task).where(sql`${task.details} ->> 'messageId' in ${ids}`);
      if (events.length > 0)
        await tx.delete(whatsappEvent).where(inArray(whatsappEvent.id, events));
      if (ids.length > 0) await tx.delete(message).where(inArray(message.id, ids));
    });
  }
});
