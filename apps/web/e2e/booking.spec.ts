import { addDays, istDate } from '@clinic-mx/schemas';
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import {
  centreIdByCode,
  expireHolds,
  holdCount,
  physioAtHsr,
  removeCalendarRows,
  testAppointment,
} from './calendar';
import { fakeMobile, fakeName, testPatient } from './patients';
import { signIn, signInWithCode, temporaryDesk, temporaryWithCode } from './staff';

// SCH-07 done when: the front desk books a caller or walk in from the calendar on the slot
// engine, for a patient found by mobile or name or added with a name and mobile only, and the
// booking records the front desk as its channel and who booked. Decisions (user, 23 October 2026):
// booking starts from a free slot or New booking; the start is held when the type is picked;
// after Book the sheet shows the new appointment. Each test has its own temporary physio at HSR
// Layout, a week ahead, and removes their appointments, holds and hours afterwards.

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

/** The calendar on the test day, on this physio's agenda on a phone. */
async function openCalendar(page: Page, physioId: string) {
  const hsr = await centreIdByCode('HSR');
  await page.goto(`/app/calendar?centre=${hsr}&date=${day}&physio=${physioId}`);
  await expect(page.getByRole('heading', { name: 'Calendar', exact: true })).toBeVisible();
}

/** Picks a free start and Book on Session: the start is held and the booking sheet opens. */
async function holdSession(page: Page, physioName: string, time: string) {
  await page.getByRole('link', { name: `Free at ${time} with ${physioName}` }).click();
  await page.getByRole('button', { name: `Book Session at ${time}` }).click();
  const sheet = page.getByRole('complementary', { name: 'Book' });
  await expect(sheet.getByTestId('hold-status')).toContainText('Held for you until');
  return sheet;
}

const appointmentAt = (page: Page, testInfo: TestInfo, patientName: string) =>
  page
    .getByTestId(testInfo.project.name === 'phone' ? 'agenda-row' : 'calendar-block')
    .filter({ hasText: patientName });

test('the front desk books a patient found by mobile from a free slot', async ({
  page,
}, testInfo) => {
  const physio = await physioWithHours();
  const patient = await testPatient();
  const desk = await temporaryDesk();
  await signIn(page, desk.email);
  await openCalendar(page, physio.id);

  const sheet = await holdSession(page, physio.name, '11:00');
  await sheet.getByLabel('Mobile or name').fill(patient.phone.slice(-10));
  await sheet.getByRole('button', { name: 'Search' }).click();
  await sheet.getByRole('button', { name: `Book for ${patient.name}` }).click();

  const drawer = page.getByRole('complementary', { name: 'Appointment' });
  await expect(drawer.getByTestId('booked')).toContainText(/Booked MVH-\d{5}/);
  await expect(drawer).toContainText('11:00 to 11:45');
  await expect(drawer).toContainText(`Front desk, by ${desk.name}`);
  await expect(drawer.getByRole('link', { name: patient.name })).toHaveAttribute(
    'href',
    `/app/patients/${patient.id}`,
  );
  await expect(appointmentAt(page, testInfo, patient.name)).toBeVisible();
  expect(await holdCount([physio.id])).toBe(0);
});

test('a new caller is added with a name and mobile and booked', async ({ page }) => {
  const physio = await physioWithHours();
  const desk = await temporaryDesk();
  await signIn(page, desk.email);
  await openCalendar(page, physio.id);

  const sheet = await holdSession(page, physio.name, '10:00');
  await sheet.getByRole('button', { name: 'Add and book' }).click();
  await expect(sheet.getByText('Enter the patient’s name.')).toBeVisible();

  const name = fakeName('Test Caller');
  await sheet.getByLabel('Name', { exact: true }).fill(name);
  await sheet.getByLabel('Mobile', { exact: true }).fill(fakeMobile().slice(3));
  await sheet.getByRole('button', { name: 'Add and book' }).click();
  const drawer = page.getByRole('complementary', { name: 'Appointment' });
  await expect(drawer.getByTestId('booked')).toContainText('Booked MVH-');
  await expect(drawer.getByRole('link', { name })).toBeVisible();
  await expect(drawer).toContainText(/HSR-\d+/);
});

test('a mobile on file lists its patients before adding another person', async ({ page }) => {
  const physio = await physioWithHours();
  const sibling = await testPatient();
  const desk = await temporaryDesk();
  await signIn(page, desk.email);
  await openCalendar(page, physio.id);

  const sheet = await holdSession(page, physio.name, '09:30');
  const name = fakeName('Test Sibling');
  await sheet.getByLabel('Name', { exact: true }).fill(name);
  await sheet.getByLabel('Mobile', { exact: true }).fill(sibling.phone.slice(3));
  await sheet.getByRole('button', { name: 'Add and book' }).click();
  await expect(sheet.getByTestId('phone-matches')).toContainText('This mobile is already on file');
  await expect(sheet.getByRole('button', { name: `Book for ${sibling.name}` })).toBeVisible();
  await sheet.getByRole('button', { name: `Add ${name} as a new person and book` }).click();
  const drawer = page.getByRole('complementary', { name: 'Appointment' });
  await expect(drawer.getByTestId('booked')).toContainText('Booked MVH-');
  await expect(drawer.getByRole('link', { name })).toBeVisible();
});

test('New booking picks the type and day, then a physio’s free start', async ({ page }) => {
  const physio = await physioWithHours();
  const patient = await testPatient();
  const desk = await temporaryDesk();
  await signIn(page, desk.email);
  await openCalendar(page, physio.id);

  await page.getByRole('link', { name: 'New booking' }).click();
  const picker = page.getByRole('complementary', { name: 'New booking' });
  await picker.getByLabel('Appointment type').selectOption({ label: 'Session' });
  await picker.getByLabel('Date').fill(day);
  await picker.getByRole('button', { name: 'Show free times' }).click();
  await picker.getByRole('button', { name: `Book Session at 12:00 with ${physio.name}` }).click();

  const sheet = page.getByRole('complementary', { name: 'Book' });
  await expect(sheet.getByTestId('hold-status')).toContainText('Held for you until');
  await sheet.getByLabel('Mobile or name').fill(patient.name);
  await sheet.getByRole('button', { name: 'Search' }).click();
  await sheet.getByRole('button', { name: `Book for ${patient.name}` }).click();
  await expect(
    page.getByRole('complementary', { name: 'Appointment' }).getByTestId('booked'),
  ).toBeVisible();
});

test('Cancel booking gives the slot back', async ({ page }) => {
  const physio = await physioWithHours();
  const desk = await temporaryDesk();
  await signIn(page, desk.email);
  await openCalendar(page, physio.id);

  const sheet = await holdSession(page, physio.name, '11:30');
  expect(await holdCount([physio.id])).toBe(1);
  await sheet.getByRole('button', { name: 'Cancel booking' }).click();
  await expect(sheet).toHaveCount(0);
  expect(await holdCount([physio.id])).toBe(0);
});

test('a start taken meanwhile is refused in the engine’s words', async ({ page }) => {
  const physio = await physioWithHours();
  const patient = await testPatient();
  const other = await testPatient();
  const desk = await temporaryDesk();
  await signIn(page, desk.email);
  await openCalendar(page, physio.id);

  const sheet = await holdSession(page, physio.name, '12:15');
  // The hold runs out and someone else books the time.
  await expireHolds([physio.id]);
  await testAppointment(physio.id, other.id, day, 12 * 60 + 15);
  await sheet.getByLabel('Mobile or name').fill(patient.name);
  await sheet.getByRole('button', { name: 'Search' }).click();
  await expect(sheet.getByTestId('hold-status')).toContainText('Your hold ran out');
  await sheet.getByRole('button', { name: `Book for ${patient.name}` }).click();
  await expect(sheet.getByRole('alert')).toContainText(
    'This slot was just booked. Pick another time.',
  );
});

test('a physio cannot book', async ({ page }) => {
  const physio = await temporaryWithCode('physiotherapist', ['HSR Layout']);
  made.push(physio.id);
  await physioAtHsr(physio.id);
  await signInWithCode(page, physio.email, physio.secret);
  await openCalendar(page, physio.id);
  await expect(page.getByRole('link', { name: 'New booking' })).toHaveCount(0);
  await page.getByRole('link', { name: `Free at 11:00 with ${physio.name}` }).click();
  const drawer = page.getByRole('complementary', { name: 'Free slot' });
  await expect(drawer).toContainText('Fits, 45 min');
  await expect(drawer.getByRole('button', { name: /^Book/ })).toHaveCount(0);
});
