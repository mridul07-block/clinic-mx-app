import {
  DAY_BEFORE_REMINDERS_JOB,
  MORNING_REMINDERS_JOB,
  appointment,
  appointmentType,
  bookAppointment,
  changeAppointment,
  createDb,
  enqueueJob,
  job,
  message,
  staffUser,
  systemActor,
  withActor,
  whatsappEvent,
} from '@clinic-mx/db';
import { addDays, istDate, istInstant } from '@clinic-mx/schemas';
import { expect, test } from '@playwright/test';
import { and, eq, inArray, or, sql } from 'drizzle-orm';
import { centreIdByCode, physioAtHsr, removeCalendarRows } from './calendar';
import { flowRequest } from './flows';
import { tickUntil } from './jobs';
import { fakeMobile, testPatient } from './patients';
import { signInWithCode, temporaryWithCode } from './staff';
import { postWebhook, webhookBody } from './whatsapp';

// WA-08 done when: the day before reminder with Confirm and Reschedule; the reminder on the day
// to every patient; Confirm sets Confirmed. The daily runs cover every appointment on their date,
// so this test books on a day no other test uses, far ahead, and runs both jobs for it through
// the tick (the messages stay Not sent here, with no WhatsApp token). The Confirm tap comes back
// through the signed webhook as Meta sends it. Generated numbers and names only.

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

const day = addDays(istDate(new Date()), 201);
const physios: string[] = [];
const numbers: string[] = [];
const waIds: string[] = [];
const jobKeys: string[] = [];

test.afterEach(async () => {
  const theirs = physios.splice(0);
  const phones = numbers.splice(0);
  const wa = waIds.splice(0);
  const keys = jobKeys.splice(0);
  await withActor(db(), systemActor('tests'), async (tx) => {
    if (keys.length) await tx.delete(job).where(inArray(job.idempotencyKey, keys));
    // The runs queued their next date's run: that one is the test's too.
    await tx
      .delete(job)
      .where(
        inArray(job.idempotencyKey, [
          [DAY_BEFORE_REMINDERS_JOB, addDays(day, 1)].join(':'),
          [MORNING_REMINDERS_JOB, addDays(day, 1)].join(':'),
        ]),
      );
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
  if (theirs.length) await removeCalendarRows(theirs);
});

async function booked(physioId: string, patientId: string, minutes: number) {
  const [session] = await db()
    .select({ id: appointmentType.id })
    .from(appointmentType)
    .where(eq(appointmentType.key, 'session'));
  if (!session) throw new Error('no Session type');
  return withActor(db(), systemActor('tests'), async (tx) =>
    bookAppointment(tx, {
      centreId: await centreIdByCode('HSR'),
      physioId,
      appointmentTypeId: session.id,
      startsAt: istInstant(day, minutes),
      holder: `test:${crypto.randomUUID()}`,
      patientId,
      channel: 'front_desk',
      bookedBy: physioId,
      step: 15,
      now: new Date(),
    }),
  );
}

/** Runs a reminder job for the test day now, through the tick, and waits for it. */
async function runReminders(
  request: Parameters<typeof tickUntil>[0],
  kind: typeof DAY_BEFORE_REMINDERS_JOB | typeof MORNING_REMINDERS_JOB,
) {
  const key = [kind, 'e2e', crypto.randomUUID()].join(':');
  jobKeys.push(key);
  await withActor(db(), systemActor('tests'), (tx) =>
    enqueueJob(tx, { kind, payload: { date: day }, runAt: new Date(), idempotencyKey: key }),
  );
  await tickUntil(request, async () => {
    const [ran] = await db().select().from(job).where(eq(job.idempotencyKey, key));
    expect(ran?.status).toBe('done');
  });
}

const remindersFor = (appointmentIds: string[], templateKey: string) =>
  db()
    .select()
    .from(message)
    .where(
      and(inArray(message.appointmentId, appointmentIds), eq(message.templateKey, templateKey)),
    );

test('reminders reach every appointment of the day; Confirm on the evening’s confirms it', async ({
  page,
}, testInfo) => {
  test.slow();
  const physio = await temporaryWithCode('physiotherapist', ['HSR Layout']);
  physios.push(physio.id);
  await physioAtHsr(physio.id);
  // A family on one number, and someone else.
  const phone = fakeMobile();
  const other = fakeMobile();
  numbers.push(phone, other);
  const parent = await testPatient({ phone });
  const child = await testPatient({ phone });
  const someone = await testPatient({ phone: other });
  const [a, b, c, gone] = [
    await booked(physio.id, parent.id, 9 * 60),
    await booked(physio.id, child.id, 10 * 60),
    await booked(physio.id, someone.id, 11 * 60),
    await booked(physio.id, someone.id, 12 * 60),
  ];
  const [admin] = await db()
    .select({ id: staffUser.id })
    .from(staffUser)
    .where(eq(staffUser.email, 'super.admin@clinicmx.test'));
  await withActor(db(), systemActor('tests'), (tx) =>
    changeAppointment(tx, {
      appointmentId: gone.id,
      status: 'cancelled',
      reason: 'clinic',
      changedBy: admin?.id ?? '',
      now: new Date(),
    }),
  );
  const ours = [a.id, b.id, c.id, gone.id];

  // The evening before: one reminder per appointment, the cancelled one left out.
  await runReminders(page.request, DAY_BEFORE_REMINDERS_JOB);
  const evening = await remindersFor(ours, 'day_before_reminder');
  expect(evening.map((m) => m.appointmentId).sort()).toEqual([a.id, b.id, c.id].sort());
  const forA = evening.find((m) => m.appointmentId === a.id);
  expect(forA).toMatchObject({ toPhone: phone, patientId: parent.id, kind: 'template' });
  expect(forA?.variables).toMatchObject({
    patient_name: parent.name.split(' ')[0],
    time: '9:00 AM',
    clinic: 'HSR Layout',
    physio: physio.name,
  });
  // A run again queues nothing more.
  await runReminders(page.request, DAY_BEFORE_REMINDERS_JOB);
  expect(await remindersFor(ours, 'day_before_reminder')).toHaveLength(3);

  // Reschedule opens the form on that appointment.
  const form = await flowRequest(
    page.request,
    { action: 'INIT', flow_token: forA?.variables.flow_token ?? '' },
    'reschedule',
  );
  expect(form.screen).toBe('DATE_TIME');
  expect(form.data?.heading).toBe(`Session ${a.number}`);

  // Confirm, tapped on the reminder Meta delivered (marked Sent here, as the send job would).
  const sentId = `wamid.e2e-${crypto.randomUUID()}`;
  await withActor(db(), systemActor('tests'), (tx) =>
    tx
      .update(message)
      .set({ status: 'sent', waMessageId: sentId, sentAt: new Date(), statusAt: new Date() })
      .where(eq(message.id, forA?.id ?? '')),
  );
  const tapId = `wamid.e2e-${crypto.randomUUID()}`;
  waIds.push(sentId, tapId);
  const tap = webhookBody({
    messages: [
      {
        from: phone.slice(1),
        id: tapId,
        timestamp: String(Math.floor(Date.now() / 1000)),
        type: 'button',
        button: { text: 'Confirm', payload: 'day_before_reminder.confirm' },
        context: { id: sentId },
      },
    ],
  });
  expect((await postWebhook(page.request, tap)).status()).toBe(200);
  await tickUntil(page.request, async () => {
    const [visit] = await db().select().from(appointment).where(eq(appointment.id, a.id));
    expect(visit?.status).toBe('confirmed');
    expect(visit?.confirmedAt).toBeTruthy();
  });
  const [thanks] = await db()
    .select()
    .from(message)
    .where(and(eq(message.toPhone, phone), eq(message.templateKey, 'appointment_confirmed')));
  expect(thanks?.variables.text).toMatch(
    /^Thank you, your appointment on .+ at 9:00 AM is confirmed\.$/,
  );
  // The child's appointment on the same number is not confirmed by the parent's tap.
  const [childVisit] = await db().select().from(appointment).where(eq(appointment.id, b.id));
  expect(childVisit?.status).toBe('booked');

  // On the day: to every patient, Confirmed or not.
  await runReminders(page.request, MORNING_REMINDERS_JOB);
  const morning = await remindersFor(ours, 'morning_reminder');
  expect(morning.map((m) => m.appointmentId).sort()).toEqual([a.id, b.id, c.id].sort());
  expect(morning.find((m) => m.appointmentId === c.id)?.variables).toEqual({
    patient_name: someone.name.split(' ')[0],
    time: '11:00 AM',
    clinic: 'HSR Layout',
  });

  // The desk sees it confirmed on WhatsApp.
  const desk = await temporaryWithCode('super_admin');
  await signInWithCode(page, desk.email, desk.secret);
  const hsr = await centreIdByCode('HSR');
  await page.goto(`/app/calendar?centre=${hsr}&date=${day}&physio=${physio.id}`);
  await page
    .getByTestId(testInfo.project.name === 'phone' ? 'agenda-row' : 'calendar-block')
    .filter({ hasText: parent.name })
    .first()
    .click();
  const sheet = page.getByRole('complementary', { name: 'Appointment' });
  await expect(sheet).toContainText('Confirmed');
  await expect(sheet).toContainText('On WhatsApp,');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: testInfo.outputPath('reminder-confirmed.png'), fullPage: true });
});
