import { istDate } from '@clinic-mx/schemas';
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { centreIdByCode, physioAtHsr, removeCalendarRows, startedAppointment } from './calendar';
import { testPatient } from './patients';
import { signIn, signInWithCode, temporaryDesk, temporaryWithCode } from './staff';

// INT-11 done when: "Running late" shows (amber) at 15 minutes past the start and the front desk
// can mark a no show from 25 minutes, both settings (PRD J2.9). Decisions (user, 23 October 2026):
// a confirm sheet, like Cancel; the front desk undoes a no show on the same day, and the count goes
// back down. Each test has its own temporary physio at HSR Layout with an appointment that started
// a little while ago, removed afterwards.

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

async function openCalendar(page: Page, physioId: string, startsAt: Date) {
  const hsr = await centreIdByCode('HSR');
  await page.goto(`/app/calendar?centre=${hsr}&date=${istDate(startsAt)}&physio=${physioId}`);
  await expect(page.getByRole('heading', { name: 'Calendar', exact: true })).toBeVisible();
}

const appointmentAt = (page: Page, testInfo: TestInfo, patientName: string) =>
  page
    .getByTestId(testInfo.project.name === 'phone' ? 'agenda-row' : 'calendar-block')
    .filter({ hasText: patientName });

const sheet = (page: Page, name: string) => page.getByRole('complementary', { name });

const istTime = (instant: Date) =>
  new Intl.DateTimeFormat('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone: 'Asia/Kolkata',
  }).format(instant);

test('running late at 20 minutes; a no show only from 25', async ({ page }, testInfo) => {
  const physio = await physioWithHours();
  const patient = await testPatient();
  const { startsAt } = await startedAppointment(physio.id, patient.id, 20);
  const desk = await temporaryDesk();
  await signIn(page, desk.email);
  await openCalendar(page, physio.id, startsAt);

  await expect(appointmentAt(page, testInfo, patient.name)).toContainText('Running late');
  await appointmentAt(page, testInfo, patient.name).click();
  const drawer = sheet(page, 'Appointment');
  await expect(drawer).toContainText('Running late');
  await expect(drawer.getByTestId('no-show-from')).toHaveText(
    `No show can be marked from ${istTime(new Date(startsAt.getTime() + 25 * 60_000))}.`,
  );
  await expect(drawer.getByRole('link', { name: 'Mark no show' })).toHaveCount(0);
});

test('the front desk marks a no show from 25 minutes and undoes it the same day', async ({
  page,
}, testInfo) => {
  const physio = await physioWithHours();
  const patient = await testPatient();
  const { number, startsAt } = await startedAppointment(physio.id, patient.id, 30);
  // An undo is for the appointment's own day; just after midnight IST it started yesterday.
  test.skip(istDate(startsAt) !== istDate(new Date()), 'The start is on yesterday’s date in IST.');
  const desk = await temporaryDesk();
  await signIn(page, desk.email);
  await openCalendar(page, physio.id, startsAt);

  await appointmentAt(page, testInfo, patient.name).click();
  await sheet(page, 'Appointment').getByRole('link', { name: 'Mark no show' }).click();
  const confirm = sheet(page, 'Mark no show');
  await expect(confirm).toContainText(`Mark ${number} as a no show?`);
  await expect(confirm).toContainText('It counts toward the self booking block.');
  await confirm.getByRole('button', { name: 'Mark no show' }).click();

  const drawer = sheet(page, 'Appointment');
  await expect(drawer).toContainText('No show');
  await expect(drawer).toContainText(`Marked by ${desk.name}`);
  await expect(drawer.getByRole('link', { name: 'Mark no show' })).toHaveCount(0);
  await expect(appointmentAt(page, testInfo, patient.name)).toContainText('No show');

  await page.goto(`/app/patients/${patient.id}`);
  await expect(page.getByTestId('booking-counts')).toContainText('No shows 1 of 2');

  await page.goBack();
  await sheet(page, 'Appointment').getByRole('button', { name: 'Undo no show' }).click();
  await expect(sheet(page, 'Appointment')).toContainText('Booked');
  await expect(sheet(page, 'Appointment')).not.toContainText('Marked by');
  await page.goto(`/app/patients/${patient.id}`);
  await expect(page.getByTestId('booking-counts')).toContainText('No shows 0 of 2');
});

test('a physio sees Running late but no no show actions', async ({ page }, testInfo) => {
  const physio = await physioWithHours();
  const patient = await testPatient();
  const { startsAt } = await startedAppointment(physio.id, patient.id, 30);
  await signInWithCode(page, physio.email, physio.secret);
  await openCalendar(page, physio.id, startsAt);

  await appointmentAt(page, testInfo, patient.name).click();
  const drawer = sheet(page, 'Appointment');
  await expect(drawer).toContainText('Running late');
  await expect(drawer.getByRole('link', { name: 'Mark no show' })).toHaveCount(0);
  await expect(drawer.getByTestId('no-show-from')).toHaveCount(0);
});
