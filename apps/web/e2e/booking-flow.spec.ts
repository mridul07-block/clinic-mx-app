import {
  createDb,
  appointment,
  job,
  message,
  systemActor,
  withActor,
  whatsappEvent,
} from '@clinic-mx/db';
import { addDays, istDate, istInstant } from '@clinic-mx/schemas';
import { expect, test } from '@playwright/test';
import { and, eq, inArray, or, sql } from 'drizzle-orm';
import {
  centreIdByCode,
  expireHolds,
  physioAtHsr,
  removeCalendarRows,
  testAppointment,
} from './calendar';
import { flowRequest, flowStep, items } from './flows';
import { tickUntil } from './jobs';
import { fakeMobile, fakeName, testPatient } from './patients';
import { signInWithCode, temporaryWithCode } from './staff';
import { postWebhook, webhookBody } from './whatsapp';

// WA-04 done when: clinic, dates with free slots, live times, physio with fee, name, confirm; a
// slot taken returns the next free times. The test plays both sides Meta stands between: it taps
// "Book appointment" through the signed webhook, then submits each screen to the data endpoint
// sealed as Meta seals them. Each test has its own temporary consultant at HSR Layout a week
// ahead; their appointments, holds and hours, and the messages made, are removed afterwards.
// Generated numbers and names only.

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

const day = addDays(istDate(new Date()), 7);
const physios: string[] = [];
const numbers: string[] = [];
const waIds: string[] = [];

test.afterEach(async () => {
  const theirs = physios.splice(0);
  const phones = numbers.splice(0);
  const wa = waIds.splice(0);
  await withActor(db(), systemActor('tests'), async (tx) => {
    // Through this transaction: the test's pool has one connection.
    if (phones.length) {
      const ids = (
        await tx
          .select({ id: message.id })
          .from(message)
          .where(or(inArray(message.fromPhone, phones), inArray(message.toPhone, phones)))
      ).map((row) => row.id);
      if (ids.length) {
        await tx.delete(job).where(
          inArray(
            job.idempotencyKey,
            ids.flatMap((id) => [`whatsapp.send:${id}`, `whatsapp.route:${id}`]),
          ),
        );
        await tx.delete(message).where(inArray(message.id, ids));
      }
      await tx.execute(sql`delete from whatsapp_flow_session where phone in ${phones}`);
    }
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
  });
  // After the Flow sessions, which point at the appointments.
  if (theirs.length) await removeCalendarRows(theirs);
});

/** A consultant with hours every day 09:00 to 13:00 at HSR Layout and the consultation fee. */
async function consultant() {
  const physio = await temporaryWithCode('physiotherapist', ['HSR Layout']);
  physios.push(physio.id);
  await physioAtHsr(physio.id, { consultant: true, feeKey: 'consultation' });
  return physio;
}

/** Taps "Book appointment" on the menu from a new number; the Flow token the reply carries. */
async function openForm(request: Parameters<typeof postWebhook>[0]) {
  const from = fakeMobile();
  numbers.push(from);
  const id = `wamid.e2e-${crypto.randomUUID()}`;
  waIds.push(id);
  const tap = webhookBody({
    messages: [
      {
        from: from.slice(1),
        id,
        timestamp: String(Math.floor(Date.now() / 1000)),
        type: 'interactive',
        interactive: {
          type: 'button_reply',
          button_reply: { id: 'menu.book', title: 'Book appointment' },
        },
      },
    ],
  });
  expect((await postWebhook(request, tap)).status()).toBe(200);
  let token = '';
  await tickUntil(request, async () => {
    const [reply] = await db()
      .select()
      .from(message)
      .where(and(eq(message.toPhone, from), eq(message.templateKey, 'booking_flow')));
    expect(reply?.variables.flowToken).toBeTruthy();
    token = reply?.variables.flowToken ?? '';
  });
  return { from, token };
}

/** Clinic and date, then the time: the Time and physio screen with the physios free then. */
async function upToTime(
  request: Parameters<typeof postWebhook>[0],
  token: string,
  minutes: number,
) {
  const hsr = await centreIdByCode('HSR');
  const opened = await flowRequest(request, { action: 'INIT', flow_token: token });
  expect(opened.screen).toBe('CLINIC_DATE');
  expect(items(opened, 'centres').map((c) => c.title)).toContain('HSR Layout');
  const dates = await flowStep(request, token, { step: 'centre', centre: hsr });
  expect(dates.data?.dates_visible).toBe(true);
  expect(items(dates, 'dates').map((d) => d.id)).toContain(day);
  const times = await flowStep(request, token, { step: 'date', centre: hsr, date: day });
  expect(times.screen).toBe('TIME_PHYSIO');
  const time = istInstant(day, minutes).toISOString();
  expect(items(times, 'times').map((t) => t.id)).toContain(time);
  const free = await flowStep(request, token, { step: 'time', time });
  return { time, free };
}

test('a new patient books a consultation through the WhatsApp form, shown on the calendar', async ({
  page,
}, testInfo) => {
  test.slow();
  const physio = await consultant();
  const { from, token } = await openForm(page.request);
  const { time, free } = await upToTime(page.request, token, 10 * 60);
  const ours = items(free, 'physios').find((p) => p.id === physio.id);
  expect(ours?.title).toBe(physio.name);
  expect(ours?.description).toMatch(/^Fee ₹/);

  const person = await flowStep(page.request, token, { step: 'slot', time, physio: physio.id });
  expect(person.screen).toBe('PERSON');
  expect(items(person, 'people')).toEqual([{ id: 'new', title: 'Someone new' }]);
  const unnamed = await flowStep(page.request, token, { step: 'person', person: 'new', name: '' });
  expect(unnamed.data?.error_message).toBe('Enter the full name of the person coming.');

  const name = fakeName();
  const summary = await flowStep(page.request, token, { step: 'person', person: 'new', name });
  expect(summary.screen).toBe('SUMMARY');
  const text = String(summary.data?.summary);
  expect(text).toContain(`Who: ${name}`);
  expect(text).toContain('Clinic: HSR Layout');
  expect(text).toContain(`Physio: ${physio.name}`);
  expect(text).toMatch(/Consultation fee: ₹[\d,]+, payable at the clinic/);

  const done = await flowStep(page.request, token, { step: 'confirm' });
  expect(done.screen).toBe('CONFIRMED');
  const number = String(done.data?.appointment);
  expect(number).toMatch(/^MVH-\d{5}$/);
  // Meta retrying the confirm books nothing more.
  expect(await flowStep(page.request, token, { step: 'confirm' })).toMatchObject({
    screen: 'CONFIRMED',
    data: { appointment: number },
  });

  const [booked] = await db().select().from(appointment).where(eq(appointment.number, number));
  expect(booked).toMatchObject({
    physioId: physio.id,
    channel: 'whatsapp',
    bookedBy: null,
    startsAt: new Date(time),
  });
  // WA-07: the booking confirmation, queued by the database and sent by the queue. They wrote to
  // us just now and no version is approved here, so it goes as the same text in a plain reply.
  await tickUntil(page.request, async () => {
    const [confirmation] = await db()
      .select()
      .from(message)
      .where(and(eq(message.toPhone, from), eq(message.templateKey, 'booking_confirmation')));
    expect(confirmation).toMatchObject({
      patientId: booked?.patientId,
      kind: 'session',
      appointmentId: booked?.id,
    });
    const said = String(confirmation?.variables.text);
    expect(said).toContain(`your appointment ${number} is booked for `);
    expect(said).toContain(`with ${physio.name} at Movementology HSR Layout.`);
    expect(said).toMatch(/Fee: ₹[\d,]+, payable at the clinic\./);
    expect(said).toContain('Please arrive 10 minutes early and bring any reports you have.');
    expect(said).toContain('Directions: ');
    expect(said).toMatch(/call the front desk on \+91 [\d ]+ or reply to this message\.$/);
  });
  // An unknown Flow token is refused as Meta expects (427).
  expect(
    (await flowRequest(page.request, { action: 'INIT', flow_token: crypto.randomUUID() })).status,
  ).toBe(427);

  // The front desk sees it on the calendar.
  const desk = await temporaryWithCode('super_admin');
  await signInWithCode(page, desk.email, desk.secret);
  const hsr = await centreIdByCode('HSR');
  await page.goto(`/app/calendar?centre=${hsr}&date=${day}&physio=${physio.id}`);
  await expect(
    page
      .getByTestId(testInfo.project.name === 'phone' ? 'agenda-row' : 'calendar-block')
      .filter({ hasText: name }),
  ).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: testInfo.outputPath('booking-flow-calendar.png'), fullPage: true });
});

test('a slot taken meanwhile sends the person back to the next free times', async ({ page }) => {
  test.slow();
  const physio = await consultant();
  const first = await openForm(page.request);
  const second = await openForm(page.request);

  // Taken while choosing: the second person cannot hold what the first holds.
  const a = await upToTime(page.request, first.token, 11 * 60);
  expect(
    await flowStep(page.request, first.token, { step: 'slot', time: a.time, physio: physio.id }),
  ).toMatchObject({ screen: 'PERSON' });
  const b = await upToTime(page.request, second.token, 9 * 60);
  const refused = await flowStep(page.request, second.token, {
    step: 'slot',
    time: a.time,
    physio: physio.id,
  });
  expect(refused.screen).toBe('TIME_PHYSIO');
  expect(refused.data?.error_message).toBe('This slot was just booked. Pick another time.');

  // Taken between choosing and confirming (the hold ran out and the front desk booked it).
  expect(
    (await flowStep(page.request, second.token, { step: 'slot', time: b.time, physio: physio.id }))
      .screen,
  ).toBe('PERSON');
  await flowStep(page.request, second.token, { step: 'person', person: 'new', name: fakeName() });
  await expireHolds([physio.id]);
  const { id: patientId } = await testPatient();
  await testAppointment(physio.id, patientId, day, 9 * 60);
  const late = await flowStep(page.request, second.token, { step: 'confirm' });
  expect(late.screen).toBe('TIME_PHYSIO');
  expect(late.data?.error_message).toBe('This slot was just booked. Pick another time.');
  expect(items(late, 'times').length).toBeGreaterThan(0);
  // The times are every physio's at the clinic; this physio is no longer offered at that time.
  const again = await flowStep(page.request, second.token, { step: 'time', time: b.time });
  expect(items(again, 'physios').map((p) => p.id)).not.toContain(physio.id);
  const [none] = await db()
    .select()
    .from(message)
    .where(and(eq(message.toPhone, second.from), eq(message.templateKey, 'booking_confirmation')));
  expect(none).toBeUndefined();
});
