import {
  appointment,
  appointmentType,
  bookAppointment,
  bookingCounter,
  centre,
  createDb,
  createFlowSession,
  insertOpeningEntry,
  job,
  message,
  patientPackage,
  staffUser,
  systemActor,
  withActor,
  whatsappEvent,
} from '@clinic-mx/db';
import { addDays, istDate, istInstant } from '@clinic-mx/schemas';
import { expect, test, type APIRequestContext } from '@playwright/test';
import { and, eq, inArray, or, sql } from 'drizzle-orm';
import { centreIdByCode, physioAtHsr, removeCalendarRows } from './calendar';
import { flowRequest, flowStep, items } from './flows';
import { tickUntil } from './jobs';
import { fakeMobile, testEpisode, testPatient } from './patients';
import { signInWithCode, temporaryWithCode } from './staff';
import { postWebhook, webhookBody } from './whatsapp';

// WA-05 done when: clinic and physio prefilled; reschedules left shown; Zero Gravity Treadmill
// blocked. Decisions (user, 31 October 2026): reschedule only (cancel by calling the clinic);
// both limits shown as they apply; dates in the next 14 days. The test plays both sides Meta
// stands between: it taps "Reschedule or cancel" through the signed webhook (or opens the form as
// the day before reminder's button does, with a session naming the appointment), then submits
// each screen to the data endpoint sealed as Meta seals them. Each test has its own temporary
// physio at HSR Layout a week ahead; their appointments, holds, hours and opening packages, and
// the messages and sessions made, are removed afterwards. Generated numbers and names only.

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

/** A physio with hours every day 09:00 to 13:00 at HSR Layout, and a patient on a new number. */
async function physioAndPatient() {
  const physio = await temporaryWithCode('physiotherapist', ['HSR Layout']);
  physios.push(physio.id);
  await physioAtHsr(physio.id);
  const phone = fakeMobile();
  numbers.push(phone);
  const patient = await testPatient({ phone });
  return { physio, patient };
}

/** Books an appointment of the type for the patient on the test day, as the system. */
async function booked(
  physioId: string,
  patientId: string,
  minutes: number,
  { typeKey = 'session', episodeId }: { typeKey?: string; episodeId?: string } = {},
) {
  const [type] = await db()
    .select({ id: appointmentType.id })
    .from(appointmentType)
    .where(eq(appointmentType.key, typeKey));
  if (!type) throw new Error(`no appointment type ${typeKey}`);
  return withActor(db(), systemActor('tests'), async (tx) =>
    bookAppointment(tx, {
      centreId: await centreIdByCode('HSR'),
      physioId,
      appointmentTypeId: type.id,
      startsAt: istInstant(day, minutes),
      holder: `test:${crypto.randomUUID()}`,
      patientId,
      episodeId,
      channel: 'front_desk',
      bookedBy: physioId,
      step: 15,
      now: new Date(),
    }),
  );
}

/** Taps "Reschedule or cancel" on the menu from the number; the Flow token the reply carries. */
async function openFromMenu(request: APIRequestContext, from: string) {
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
          button_reply: { id: 'menu.reschedule', title: 'Reschedule or cancel' },
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
      .where(and(eq(message.toPhone, from), eq(message.templateKey, 'reschedule_flow')));
    expect(reply?.variables.flowToken).toBeTruthy();
    token = reply?.variables.flowToken ?? '';
  });
  return token;
}

/** The session the day before reminder's Reschedule button carries (WA-08): one appointment. */
function reminderToken(phone: string, appointmentId: string) {
  return withActor(db(), systemActor('tests'), (tx) =>
    createFlowSession(tx, {
      phone,
      kind: 'reschedule',
      expiresAt: istInstant(day, 9 * 60),
      state: { appointmentId, fixed: true },
    }),
  );
}

const step = (request: APIRequestContext, token: string, data: Record<string, unknown>) =>
  flowStep(request, token, data, 'reschedule');
const open = (request: APIRequestContext, token: string) =>
  flowRequest(request, { action: 'INIT', flow_token: token }, 'reschedule');

test('a patient moves their appointment from the menu, prefilled, and the desk sees it', async ({
  page,
}, testInfo) => {
  test.slow();
  const { physio, patient } = await physioAndPatient();
  const old = await booked(physio.id, patient.id, 10 * 60);
  const token = await openFromMenu(page.request, patient.phone);

  // The number's upcoming appointments; this one.
  const opened = await open(page.request, token);
  expect(opened.screen).toBe('APPOINTMENT');
  expect(items(opened, 'appointments')).toEqual([
    {
      id: old.id,
      title: expect.stringMatching(/, 10:00 AM$/) as unknown as string,
      description: `${patient.name}: Session with ${physio.name}, HSR Layout`,
    },
  ]);

  // Clinic and physio prefilled; the reschedules left; the date only, then the time.
  const dates = await step(page.request, token, { step: 'appointment', appointment: old.id });
  expect(dates.screen).toBe('DATE_TIME');
  expect(dates.data?.heading).toBe(`Session ${old.number}`);
  expect(String(dates.data?.details)).toContain('Clinic: HSR Layout');
  expect(String(dates.data?.details)).toContain(`Physio: ${physio.name}`);
  expect(dates.data?.allowance).toBe('You can move appointments online 2 more times.');
  expect(String(dates.data?.cancel_note)).toMatch(/^To cancel, call the clinic/);
  expect(items(dates, 'dates').map((d) => d.id)).toContain(day);
  expect(dates.data?.times_visible).toBe(false);
  const times = await step(page.request, token, { step: 'date', date: day });
  const eleven = istInstant(day, 11 * 60).toISOString();
  const ids = items(times, 'times').map((t) => t.id);
  expect(ids).toContain(eleven);
  // Its own time is not offered as a move.
  expect(ids).not.toContain(istInstant(day, 10 * 60).toISOString());

  const summary = await step(page.request, token, { step: 'slot', date: day, time: eleven });
  expect(summary.screen).toBe('SUMMARY');
  expect(String(summary.data?.summary)).toContain(`Move Session ${old.number}`);
  expect(String(summary.data?.summary)).toMatch(/To: .*, 11:00 AM/);

  const done = await step(page.request, token, { step: 'confirm' });
  expect(done.screen).toBe('DONE');
  const number = String(done.data?.appointment);
  expect(number).toMatch(/^MVH-\d{5}$/);
  // Meta retrying the confirm moves nothing more.
  expect(await step(page.request, token, { step: 'confirm' })).toMatchObject({
    screen: 'DONE',
    data: { appointment: number },
  });

  // As the front desk's move asked by the patient, on WhatsApp, with no staff member.
  const [was] = await db().select().from(appointment).where(eq(appointment.id, old.id));
  expect(was).toMatchObject({
    status: 'rescheduled',
    changeReason: 'patient',
    changeChannel: 'whatsapp',
    changedBy: null,
  });
  const [now] = await db().select().from(appointment).where(eq(appointment.number, number));
  expect(now).toMatchObject({
    rescheduledFromId: old.id,
    physioId: physio.id,
    channel: 'whatsapp',
    startsAt: new Date(eleven),
  });
  const [counted] = await db()
    .select()
    .from(bookingCounter)
    .where(eq(bookingCounter.patientId, patient.id));
  expect(counted?.reschedules).toBe(1);
  // WA-07: the moved appointment gets the booking confirmation with its new number.
  await tickUntil(page.request, async () => {
    const [confirmation] = await db()
      .select()
      .from(message)
      .where(
        and(eq(message.toPhone, patient.phone), eq(message.templateKey, 'booking_confirmation')),
      );
    expect(confirmation?.appointmentId).toBe(now?.id);
    expect(String(confirmation?.variables.text)).toContain(`your appointment ${number} is booked`);
  });

  // The completed form comes back through the webhook: known by its token, no reply.
  const completion = `wamid.e2e-${crypto.randomUUID()}`;
  waIds.push(completion);
  const finished = webhookBody({
    messages: [
      {
        from: patient.phone.slice(1),
        id: completion,
        timestamp: String(Math.floor(Date.now() / 1000)),
        type: 'interactive',
        interactive: {
          type: 'nfm_reply',
          nfm_reply: {
            name: 'flow',
            body: 'Sent',
            response_json: JSON.stringify({ flow_token: token, appointment: number }),
          },
        },
      },
    ],
  });
  expect((await postWebhook(page.request, finished)).status()).toBe(200);
  await tickUntil(page.request, async () => {
    const [routed] = await db().select().from(message).where(eq(message.waMessageId, completion));
    expect(routed?.route).toBe('reschedule_flow');
  });
  const replies = await db()
    .select({ key: message.templateKey })
    .from(message)
    .where(eq(message.toPhone, patient.phone));
  // The old appointment's own front desk confirmation (WA-07) is not a reply to the form.
  expect(
    replies
      .map((r) => r.key)
      .filter((key) => key !== 'front_desk_booking_confirmation')
      .sort(),
  ).toEqual(['booking_confirmation', 'reschedule_flow']);

  // The desk sees who moved it, and where.
  const desk = await temporaryWithCode('super_admin');
  await signInWithCode(page, desk.email, desk.secret);
  const hsr = await centreIdByCode('HSR');
  await page.goto(`/app/calendar?centre=${hsr}&date=${day}&physio=${physio.id}`);
  await page
    .getByTestId(testInfo.project.name === 'phone' ? 'agenda-row' : 'calendar-block')
    .filter({ hasText: patient.name })
    .filter({ hasText: '10:00' })
    .first()
    .click();
  const sheet = page.getByRole('complementary', { name: 'Appointment' });
  await expect(sheet).toContainText('By the patient, on WhatsApp');
  // "Rescheduled to" the new appointment, linked.
  await expect(sheet.getByRole('link', { name: number, exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: testInfo.outputPath('reschedule-flow-desk.png'), fullPage: true });
});

test('the reminder’s form refuses a Zero Gravity Treadmill session, a used up package and a blocked patient', async ({
  page,
}, testInfo) => {
  test.slow();
  const { physio, patient } = await physioAndPatient();
  const blockedMessage = async (appointmentId: string) => {
    const answer = await open(page.request, await reminderToken(patient.phone, appointmentId));
    expect(answer.screen).toBe('BLOCKED');
    return String(answer.data?.message);
  };

  // Zero Gravity Treadmill: never moved online. Each project its own time on the one treadmill.
  const treadmill = await booked(
    physio.id,
    patient.id,
    testInfo.project.name === 'phone' ? 9 * 60 : 12 * 60,
    { typeKey: 'zero_gravity_treadmill' },
  );
  expect(await blockedMessage(treadmill.id)).toMatch(
    /^Zero Gravity Treadmill sessions cannot be moved online\./,
  );

  // A package session: its reschedules left shown; none left, refused.
  const episodeId = await testEpisode(patient.id, 'active');
  const hsr = await centreIdByCode('HSR');
  await withActor(db(), systemActor('tests'), async (tx) => {
    const [admin] = await tx
      .select({ id: staffUser.id })
      .from(staffUser)
      .where(eq(staffUser.email, 'super.admin@clinicmx.test'));
    if (!admin) throw new Error('no seed Super Admin');
    const claims = JSON.stringify({ clinic: { staff_id: admin.id, role: 'super_admin' } });
    await tx.execute(sql`select set_config('request.jwt.claims', ${claims}, true)`);
    await insertOpeningEntry(tx, {
      patientId: patient.id,
      episodeId,
      centreId: hsr,
      physioId: physio.id,
      sessionsLeft: 12,
      validUntil: addDays(istDate(new Date()), 60),
      by: admin.id,
    });
  });
  const session = await booked(physio.id, patient.id, 10 * 60, { episodeId });
  const opened = await open(page.request, await reminderToken(patient.phone, session.id));
  // From the reminder: straight to the date, the appointment named.
  expect(opened.screen).toBe('DATE_TIME');
  expect(opened.data?.allowance).toBe(
    'This package has 1 reschedule left; moving uses one.\nYou can move appointments online 2 more times.',
  );
  await withActor(db(), systemActor('tests'), (tx) =>
    tx
      .update(patientPackage)
      .set({ reschedulesLeft: 0 })
      .where(eq(patientPackage.episodeId, episodeId)),
  );
  expect(await blockedMessage(session.id)).toMatch(
    /^This package has no reschedules left, so this session cannot be moved online\./,
  );

  // Self booking blocked after 2 reschedules (SCH-09): refused for any appointment.
  const visit = await booked(physio.id, patient.id, 11 * 60);
  await withActor(db(), systemActor('tests'), (tx) =>
    tx
      .insert(bookingCounter)
      .values({ patientId: patient.id, reschedules: 2 })
      .onConflictDoUpdate({ target: bookingCounter.patientId, set: { reschedules: 2 } }),
  );
  const message = await blockedMessage(visit.id);
  expect(message).toMatch(/^Online changes are paused for this patient/);
  const [phone] = await db().select({ phone: centre.phone }).from(centre).where(eq(centre.id, hsr));
  if (phone?.phone) expect(message).toContain(phone.phone);
});

test('a time taken meanwhile sends them back to the free times', async ({ page }) => {
  test.slow();
  const { physio, patient } = await physioAndPatient();
  const visit = await booked(physio.id, patient.id, 10 * 60);
  const token = await reminderToken(patient.phone, visit.id);
  await open(page.request, token);
  const times = await step(page.request, token, { step: 'date', date: day });
  const noon = istInstant(day, 12 * 60).toISOString();
  expect(items(times, 'times').map((t) => t.id)).toContain(noon);
  // Someone else books it at the desk before they pick it.
  const other = await testPatient();
  await booked(physio.id, other.id, 12 * 60);
  const refused = await step(page.request, token, { step: 'slot', date: day, time: noon });
  expect(refused.screen).toBe('DATE_TIME');
  expect(refused.data?.error_message).toBe('This slot was just booked. Pick another time.');
  expect(items(refused, 'times').map((t) => t.id)).not.toContain(noon);
  const [still] = await db().select().from(appointment).where(eq(appointment.id, visit.id));
  expect(still?.status).toBe('booked');
});
