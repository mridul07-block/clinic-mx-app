import { appointment, centre, createDb, job, message, systemActor, withActor } from '@clinic-mx/db';
import { addDays, formatIndianPhone, istDate } from '@clinic-mx/schemas';
import { expect, test } from '@playwright/test';
import { and, eq, inArray } from 'drizzle-orm';
import { centreIdByCode, physioAtHsr, removeCalendarRows } from './calendar';
import { tickUntil } from './jobs';
import { testPatient } from './patients';
import { signIn, temporaryDesk, temporaryWithCode } from './staff';

// WA-07 done when: the same confirmation for WhatsApp and front desk bookings. The desk books
// from the calendar; the database queues the booking confirmation and the tick queues it for the
// patient with everything PRD J1.4 lists (Not sent here, with no WhatsApp token). The WhatsApp
// side is in booking-flow.spec.ts and reschedule-flow.spec.ts. Generated numbers and names only.

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

const day = addDays(istDate(new Date()), 9);
const made: string[] = [];
const phones: string[] = [];

test.afterEach(async () => {
  const theirs = phones.splice(0);
  if (theirs.length) {
    await withActor(db(), systemActor('tests'), async (tx) => {
      const ids = (
        await tx.select({ id: message.id }).from(message).where(inArray(message.toPhone, theirs))
      ).map((row) => row.id);
      if (ids.length) {
        await tx.delete(job).where(
          inArray(
            job.idempotencyKey,
            ids.map((id) => ['whatsapp.send', id].join(':')),
          ),
        );
        await tx.delete(message).where(inArray(message.id, ids));
      }
    });
  }
  if (made.length) await removeCalendarRows(made.splice(0));
});

test('a front desk booking gets the same confirmation, with everything the patient needs', async ({
  page,
}) => {
  const physio = await temporaryWithCode('physiotherapist', ['HSR Layout']);
  made.push(physio.id);
  await physioAtHsr(physio.id);
  const patient = await testPatient();
  phones.push(patient.phone);
  const desk = await temporaryDesk();
  await signIn(page, desk.email);
  const hsr = await centreIdByCode('HSR');
  await page.goto(`/app/calendar?centre=${hsr}&date=${day}&physio=${physio.id}`);

  await page.getByRole('link', { name: `Free at 11:00 with ${physio.name}` }).click();
  await page.getByRole('button', { name: 'Book Session at 11:00' }).click();
  const sheet = page.getByRole('complementary', { name: 'Book' });
  await sheet.getByLabel('Mobile or name').fill(patient.phone.slice(-10));
  await sheet.getByRole('button', { name: 'Search' }).click();
  await sheet.getByRole('button', { name: `Book for ${patient.name}` }).click();
  const drawer = page.getByRole('complementary', { name: 'Appointment' });
  await expect(drawer.getByTestId('booked')).toContainText(/Booked MVH-\d{5}/);
  await expect(drawer.getByTestId('booked')).toContainText(
    'The patient gets the confirmation on WhatsApp.',
  );
  await page.screenshot({
    path: ['test-results/wa-07-booked', test.info().project.name, 'png'].join('.'),
  });

  const [booked] = await db()
    .select({ id: appointment.id, number: appointment.number })
    .from(appointment)
    .where(and(eq(appointment.patientId, patient.id), eq(appointment.physioId, physio.id)));
  if (!booked) throw new Error('not booked');
  const [hsrCentre] = await db()
    .select({ phone: centre.phone, mapLink: centre.mapLink, address: centre.address })
    .from(centre)
    .where(eq(centre.id, hsr));
  await tickUntil(page.request, async () => {
    const [confirmation] = await db()
      .select()
      .from(message)
      .where(eq(message.sourceKey, ['whatsapp.booking_confirmation', booked.id].join(':')));
    // The patient never wrote to us, so it waits as the template for Meta's approval.
    expect(confirmation).toMatchObject({
      patientId: patient.id,
      toPhone: patient.phone,
      kind: 'template',
      templateKey: 'front_desk_booking_confirmation',
      templateVersion: 2,
      appointmentId: booked.id,
      variables: {
        patient_name: patient.name.split(' ')[0],
        appointment_id: booked.number,
        time: '11:00 AM',
        physio: physio.name,
        clinic: 'HSR Layout',
        fee: 'as per your treatment plan',
        directions: hsrCentre?.mapLink ?? hsrCentre?.address ?? 'please ask the front desk',
        clinic_phone: formatIndianPhone(hsrCentre?.phone ?? ''),
      },
    });
  });

  // One confirmation for the booking, however often the queue runs.
  await tickUntil(page.request, async () => {
    const confirmations = await db()
      .select({ id: message.id })
      .from(message)
      .where(
        and(
          eq(message.toPhone, patient.phone),
          eq(message.templateKey, 'front_desk_booking_confirmation'),
        ),
      );
    expect(confirmations).toHaveLength(1);
  });
});
