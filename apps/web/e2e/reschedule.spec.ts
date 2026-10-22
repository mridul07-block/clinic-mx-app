import { addDays, istDate } from '@clinic-mx/schemas';
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { centreIdByCode, physioAtHsr, removeCalendarRows, testAppointment } from './calendar';
import { testPatient } from './patients';
import { signIn, signInWithCode, temporaryDesk, temporaryWithCode } from './staff';

// SCH-08 done when: from an appointment's sheet the front desk cancels or reschedules a Booked or
// Confirmed appointment, recording who asked (the patient or the clinic), who did it and when.
// Decisions (user, 23 October 2026): Booked or Confirmed any time until check in; a move keeps
// the type, on any day and with any physio, and books a new appointment number; who asked is one
// of two. Each test has its own temporary physios at HSR Layout, a week ahead, removed afterwards.

const day = addDays(istDate(new Date()), 7);
const made: string[] = [];
test.afterEach(async () => {
  if (made.length) await removeCalendarRows(made.splice(0));
});

async function physioWithHours() {
  const physio = await temporaryWithCode('physiotherapist', ['HSR Layout']);
  made.push(physio.id);
  await physioAtHsr(physio.id);
  return physio;
}

async function openCalendar(page: Page, physioId: string, date = day) {
  const hsr = await centreIdByCode('HSR');
  await page.goto(`/app/calendar?centre=${hsr}&date=${date}&physio=${physioId}`);
  await expect(page.getByRole('heading', { name: 'Calendar', exact: true })).toBeVisible();
}

const appointmentAt = (page: Page, testInfo: TestInfo, patientName: string) =>
  page
    .getByTestId(testInfo.project.name === 'phone' ? 'agenda-row' : 'calendar-block')
    .filter({ hasText: patientName });

const sheet = (page: Page, name: string) => page.getByRole('complementary', { name });

test('the front desk cancels an appointment the patient asked to cancel', async ({
  page,
}, testInfo) => {
  const physio = await physioWithHours();
  const patient = await testPatient();
  const number = await testAppointment(physio.id, patient.id, day, 10 * 60);
  const desk = await temporaryDesk();
  await signIn(page, desk.email);
  await openCalendar(page, physio.id);

  await appointmentAt(page, testInfo, patient.name).click();
  await sheet(page, 'Appointment').getByRole('link', { name: 'Cancel appointment' }).click();
  const cancel = sheet(page, 'Cancel appointment');
  await expect(cancel).toContainText(number);
  await cancel.getByRole('button', { name: 'Cancel appointment' }).click();
  await expect(cancel.getByText('Choose who asked for the change.')).toBeVisible();
  await cancel.getByRole('radio', { name: 'By the patient' }).check();
  await cancel.getByRole('button', { name: 'Cancel appointment' }).click();

  const drawer = sheet(page, 'Appointment');
  await expect(drawer).toContainText('Cancelled');
  await expect(drawer).toContainText(`By the patient, by ${desk.name}`);
  await expect(drawer.getByRole('link', { name: 'Reschedule' })).toHaveCount(0);
  await expect(drawer.getByRole('link', { name: 'Cancel appointment' })).toHaveCount(0);
  await drawer.getByRole('link', { name: 'Close' }).click();
  // The time is free again.
  await expect(page.getByRole('link', { name: `Free at 10:00 with ${physio.name}` })).toBeVisible();
});

test('the front desk moves an appointment to another day and physio', async ({
  page,
}, testInfo) => {
  const physio = await physioWithHours();
  const colleague = await physioWithHours();
  const patient = await testPatient();
  const number = await testAppointment(physio.id, patient.id, day, 10 * 60);
  const desk = await temporaryDesk();
  await signIn(page, desk.email);
  await openCalendar(page, physio.id);

  await appointmentAt(page, testInfo, patient.name).click();
  await sheet(page, 'Appointment').getByRole('link', { name: 'Reschedule' }).click();
  const picker = sheet(page, 'Reschedule');
  await expect(picker.getByLabel('Physio', { exact: true })).toHaveValue(physio.id);
  await picker.getByLabel('Date').fill(addDays(day, 1));
  await picker.getByLabel('Physio', { exact: true }).selectOption({ label: colleague.name });
  await picker.getByRole('button', { name: 'Show free times' }).click();
  await picker.getByRole('button', { name: `Move to 11:00 with ${colleague.name}` }).click();

  const confirm = sheet(page, 'Reschedule');
  await expect(confirm.getByTestId('hold-status')).toContainText('Held for you until');
  await expect(confirm).toContainText(`11:00 with ${colleague.name}`);
  await confirm.getByRole('radio', { name: 'By the clinic' }).check();
  await confirm.getByRole('button', { name: 'Reschedule' }).click();

  const moved = sheet(page, 'Appointment');
  await expect(moved.getByTestId('moved')).toContainText(/Rescheduled to MVH-\d{5}/);
  await expect(moved).toContainText('11:00 to 11:45');
  await expect(moved).toContainText(`${colleague.name} at HSR Layout`);
  await expect(moved).toContainText(`Front desk, by ${desk.name}`);
  await moved.getByRole('link', { name: number }).click();

  const old = sheet(page, 'Appointment');
  await expect(old).toContainText('Rescheduled');
  await expect(old).toContainText(`By the clinic, by ${desk.name}`);
  await expect(old.getByRole('link', { name: /^MVH-\d{5}$/ })).toBeVisible();
});

test('an appointment moves to an overlapping time with the same physio', async ({
  page,
}, testInfo) => {
  const physio = await physioWithHours();
  const patient = await testPatient();
  await testAppointment(physio.id, patient.id, day, 10 * 60);
  const desk = await temporaryDesk();
  await signIn(page, desk.email);
  await openCalendar(page, physio.id);

  await appointmentAt(page, testInfo, patient.name).click();
  await sheet(page, 'Appointment').getByRole('link', { name: 'Reschedule' }).click();
  await sheet(page, 'Reschedule')
    .getByRole('button', { name: `Move to 10:30 with ${physio.name}` })
    .click();
  const confirm = sheet(page, 'Reschedule');
  await confirm.getByRole('radio', { name: 'By the patient' }).check();
  await confirm.getByRole('button', { name: 'Reschedule' }).click();
  await expect(sheet(page, 'Appointment').getByTestId('moved')).toBeVisible();
  await expect(sheet(page, 'Appointment')).toContainText('10:30 to 11:15');
});

test('a physio cannot reschedule or cancel', async ({ page }, testInfo) => {
  const physio = await temporaryWithCode('physiotherapist', ['HSR Layout']);
  made.push(physio.id);
  await physioAtHsr(physio.id);
  const patient = await testPatient();
  await testAppointment(physio.id, patient.id, day, 10 * 60);
  await signInWithCode(page, physio.email, physio.secret);
  await openCalendar(page, physio.id);
  await appointmentAt(page, testInfo, patient.name).click();
  const drawer = sheet(page, 'Appointment');
  await expect(drawer).toContainText('Booked');
  await expect(drawer.getByRole('link', { name: 'Reschedule' })).toHaveCount(0);
  await expect(drawer.getByRole('link', { name: 'Cancel appointment' })).toHaveCount(0);
});
