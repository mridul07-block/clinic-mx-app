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
// ALT-04 done when: a confirmed no show gives the front desk a call task (and queues the message),
// an undone one closes it, and two missed in a row give the physio a clinical review task (user
// decision 24 October 2026: the physio of the missed appointment).

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

/** As the call task's title writes it: "9:05 AM" and "Fri 24 Oct", in IST. */
const istClock = (instant: Date) => {
  const [hours = 0, minutes = 0] = istTime(instant).split(':').map(Number);
  const minute = String(minutes).padStart(2, '0');
  return `${hours % 12 || 12}:${minute} ${hours < 12 ? 'AM' : 'PM'}`;
};
const istDay = (instant: Date) => {
  const part = (options: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat('en-GB', { ...options, timeZone: 'Asia/Kolkata' }).format(instant);
  return `${part({ weekday: 'short' })} ${part({ day: 'numeric' })} ${part({ month: 'short' })}`;
};

test('running late at 20 minutes; a no show only from 25', async ({ page }, testInfo) => {
  const physio = await physioWithHours();
  const patient = await testPatient();
  const { startsAt } = await startedAppointment(physio.id, patient.id, 20, { exact: true });
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
  const { number, startsAt } = await startedAppointment(physio.id, patient.id, 30, { exact: true });
  // An undo is for the appointment's own day; just after midnight IST it started yesterday.
  test.skip(istDate(startsAt) !== istDate(new Date()), 'The start is on yesterday’s date in IST.');
  const desk = await temporaryDesk();
  await signIn(page, desk.email);
  await openCalendar(page, physio.id, startsAt);

  await appointmentAt(page, testInfo, patient.name).click();
  await sheet(page, 'Appointment').getByRole('link', { name: 'Mark no show' }).click();
  const confirm = sheet(page, 'Mark no show');
  await expect(confirm).toContainText(`Mark ${number} as a no show?`);
  await expect(confirm).toContainText(
    'It counts toward the self booking block, and the front desk gets a call task.',
  );
  await confirm.getByRole('button', { name: 'Mark no show' }).click();

  const drawer = sheet(page, 'Appointment');
  await expect(drawer).toContainText('No show');
  await expect(drawer).toContainText(`Marked by ${desk.name}`);
  await expect(drawer.getByRole('link', { name: 'Mark no show' })).toHaveCount(0);
  await expect(appointmentAt(page, testInfo, patient.name)).toContainText('No show');

  await page.goto(`/app/patients/${patient.id}`);
  await expect(page.getByTestId('booking-counts')).toContainText('No shows 1 of 2');

  // The desk's call task, with the patient.
  await page.goto('/app/tasks');
  const call = page
    .getByTestId('open-tasks')
    .getByTestId('task-card')
    .filter({ hasText: patient.name });
  await expect(call).toHaveCount(1);
  await expect(call).toContainText(
    `Call about the missed ${istClock(startsAt)} appointment on ${istDay(startsAt)}`,
  );
  await expect(call).toContainText('Call after a no show');
  await expect(call).toContainText('High');

  await openCalendar(page, physio.id, startsAt);
  await appointmentAt(page, testInfo, patient.name).click();
  await sheet(page, 'Appointment').getByRole('button', { name: 'Undo no show' }).click();
  await expect(sheet(page, 'Appointment')).toContainText('Booked');
  await expect(sheet(page, 'Appointment')).not.toContainText('Marked by');
  await page.goto(`/app/patients/${patient.id}`);
  await expect(page.getByTestId('booking-counts')).toContainText('No shows 0 of 2');

  // Undone: the call task closed by itself, as the desk.
  await page.goto('/app/tasks');
  await expect(
    page.getByTestId('open-tasks').getByTestId('task-card').filter({ hasText: patient.name }),
  ).toHaveCount(0);
  await expect(
    page
      .getByTestId('closed-tasks')
      .getByTestId('task-card')
      .filter({ hasText: patient.name })
      .getByTestId('task-decision'),
  ).toContainText(`Closed automatically: the no show was undone. · `);
});

test('a second missed appointment in a row gives the physio a clinical review task', async ({
  page,
}, testInfo) => {
  const physio = await physioWithHours();
  const patient = await testPatient();
  const desk = await temporaryDesk();
  // The earlier miss, two days ago, already marked.
  await startedAppointment(physio.id, patient.id, 2 * 24 * 60, {
    exact: true,
    values: { status: 'no_show', noShowAt: new Date(), noShowBy: desk.id },
  });
  const { startsAt } = await startedAppointment(physio.id, patient.id, 30, { exact: true });
  await signIn(page, desk.email);
  await openCalendar(page, physio.id, startsAt);
  await appointmentAt(page, testInfo, patient.name).click();
  await sheet(page, 'Appointment').getByRole('link', { name: 'Mark no show' }).click();
  await sheet(page, 'Mark no show').getByRole('button', { name: 'Mark no show' }).click();
  await expect(sheet(page, 'Appointment')).toContainText('Marked by');

  // Not the desk's: the physio's.
  await page.goto('/app/tasks');
  await expect(page.getByTestId('task-card').filter({ hasText: 'Clinical review' })).toHaveCount(0);
  await page.context().clearCookies();
  await signInWithCode(page, physio.email, physio.secret);
  await page.goto('/app/tasks');
  const review = page
    .getByTestId('open-tasks')
    .getByTestId('task-card')
    .filter({ hasText: patient.name });
  await expect(review).toHaveCount(1);
  await expect(review).toContainText('Clinical review: 2 missed appointments in a row');
  await expect(review).toContainText('Clinical review: missed appointments');
  await expect(review.getByTestId('task-holder')).toHaveText('For you');
  await page.screenshot({ path: testInfo.outputPath('clinical-review.png'), fullPage: true });
});

test('a physio sees Running late but no no show actions', async ({ page }, testInfo) => {
  const physio = await physioWithHours();
  const patient = await testPatient();
  const { startsAt } = await startedAppointment(physio.id, patient.id, 30, { exact: true });
  await signInWithCode(page, physio.email, physio.secret);
  await openCalendar(page, physio.id, startsAt);

  await appointmentAt(page, testInfo, patient.name).click();
  const drawer = sheet(page, 'Appointment');
  await expect(drawer).toContainText('Running late');
  await expect(drawer.getByRole('link', { name: 'Mark no show' })).toHaveCount(0);
  await expect(drawer.getByTestId('no-show-from')).toHaveCount(0);
});
