import { addDays, istDate } from '@clinic-mx/schemas';
import { expect, test } from '@playwright/test';
import { centreIdByCode, physioAtHsr, removeCalendarRows, testMove } from './calendar';
import { testPatient } from './patients';
import { signIn, signInWithCode, temporaryDesk, temporaryWithCode } from './staff';

// SCH-09 done when: reschedules asked by the patient and verified no shows are counted; at 2 of
// either (the settings) self booking is blocked and staff see it; the front desk can still book.
// Decisions (user, 23 October 2026): only reschedules asked by the patient count; a Centre Manager
// or the Super Admin lifts the block. Each test has its own temporary physio at HSR Layout.

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

test('two reschedules asked by the patient block self booking; the desk still books', async ({
  page,
}) => {
  const physio = await physioWithHours();
  const patient = await testPatient();
  await testMove(physio.id, patient.id, day, 9 * 60, 10 * 60, 'patient');
  await testMove(physio.id, patient.id, day, 11 * 60, 12 * 60, 'patient');
  const desk = await temporaryDesk();
  await signIn(page, desk.email);

  await page.goto(`/app/patients/${patient.id}`);
  await expect(page.getByTestId('self-booking-blocked')).toContainText(
    'Self booking blocked: 2 reschedules asked by the patient.',
  );
  await expect(page.getByTestId('booking-counts')).toContainText(
    'Reschedules asked by the patient 2 of 2 · No shows 0 of 2',
  );
  await expect(page.getByRole('button', { name: 'Allow self booking again' })).toHaveCount(0);

  const hsr = await centreIdByCode('HSR');
  await page.goto(`/app/calendar?centre=${hsr}&date=${day}&physio=${physio.id}`);
  await page.getByRole('link', { name: `Free at 11:00 with ${physio.name}` }).click();
  await page.getByRole('button', { name: 'Book Session at 11:00' }).click();
  const sheet = page.getByRole('complementary', { name: 'Book' });
  await sheet.getByLabel('Mobile or name').fill(patient.name);
  await sheet.getByRole('button', { name: 'Search' }).click();
  await sheet.getByRole('button', { name: `Book for ${patient.name}` }).click();
  await expect(
    page.getByRole('complementary', { name: 'Appointment' }).getByTestId('booked'),
  ).toContainText('Booked MVH-');
});

test('a reschedule asked by the clinic does not count', async ({ page }) => {
  const physio = await physioWithHours();
  const patient = await testPatient();
  await testMove(physio.id, patient.id, day, 9 * 60, 10 * 60, 'clinic');
  const desk = await temporaryDesk();
  await signIn(page, desk.email);
  await page.goto(`/app/patients/${patient.id}`);
  await expect(page.getByTestId('self-booking-allowed')).toHaveText('Can book on WhatsApp.');
  await expect(page.getByTestId('booking-counts')).toContainText(
    'Reschedules asked by the patient 0 of 2',
  );
});

test('a Centre Manager lets the patient book themselves again', async ({ page }) => {
  const physio = await physioWithHours();
  const patient = await testPatient();
  await testMove(physio.id, patient.id, day, 9 * 60, 10 * 60, 'patient');
  await testMove(physio.id, patient.id, day, 11 * 60, 12 * 60, 'patient');
  const manager = await temporaryWithCode('centre_manager', ['HSR Layout']);
  await signInWithCode(page, manager.email, manager.secret);

  await page.goto(`/app/patients/${patient.id}`);
  await expect(page.getByTestId('self-booking-blocked')).toBeVisible();
  await page.getByRole('button', { name: 'Allow self booking again' }).click();
  await expect(page.getByText('The patient can book themselves again.')).toBeVisible();
  await expect(page.getByTestId('self-booking-allowed')).toBeVisible();
  await expect(page.getByTestId('booking-counts')).toContainText(
    'Reschedules asked by the patient 0 of 2 · No shows 0 of 2',
  );
  await expect(page.getByText(`Last allowed again by ${manager.name}`)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Allow self booking again' })).toHaveCount(0);
});
