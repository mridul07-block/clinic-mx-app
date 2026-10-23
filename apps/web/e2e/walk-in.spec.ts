import { expect, test, type Page } from '@playwright/test';
import { appointmentsOf, physioAtHsr, removeCalendarRows } from './calendar';
import { fakeMobile, fakeName, testPatient } from './patients';
import { signIn, temporaryDesk, temporaryWithCode } from './staff';

// INT-12 done when: a walk in is booked and checked in in one action. Decisions (user, 23 October
// 2026): "Walk in" on Today opens the booking sheets for today; the desk picks the type and a
// physio's next free start, finds or adds the patient, ticks that it checked who this is, and
// presses Book and check in; the booking is the Walk in channel; the check in drawer opens after.
// Each test has its own temporary physio with hours all day at HSR Layout.

const made: string[] = [];
test.afterEach(async () => {
  if (made.length) await removeCalendarRows(made.splice(0));
});

const tick = 'I have checked who this is (name and date of birth)';
const drawer = (page: Page) => page.getByRole('complementary', { name: 'Check in' });

/** A physio free all day, and the desk on Today with the Walk in sheet's free times for Session. */
async function walkInSheet(page: Page) {
  // The last Session start is 23:00; near midnight in IST there is nothing left to book.
  const [hour = 0, minute = 0] = new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone: 'Asia/Kolkata',
  })
    .format(new Date())
    .split(':')
    .map(Number);
  const minutes = hour * 60 + minute;
  test.skip(minutes > 22 * 60 + 40, 'No Session start left today in IST.');
  const physio = await temporaryWithCode('physiotherapist', ['HSR Layout']);
  made.push(physio.id);
  await physioAtHsr(physio.id, { hours: [{ starts: 0, ends: 24 * 60 - 15 }] });
  const desk = await temporaryDesk();
  await signIn(page, desk.email);
  await expect(page).toHaveURL(/\/app\/today/);
  await page.getByRole('link', { name: 'Walk in' }).click();
  const sheet = page.getByRole('complementary', { name: 'Walk in' });
  await expect(sheet.getByRole('heading', { name: 'Walk in' })).toBeVisible();
  await expect(sheet).toContainText('Today,');
  await sheet.getByLabel('Appointment type').selectOption({ label: 'Session' });
  await sheet.getByRole('button', { name: 'Show free times' }).click();
  await sheet
    .getByRole('button', { name: `Session at` })
    .and(sheet.getByRole('button', { name: `with ${physio.name}` }))
    .first()
    .click();
  const booking = page.getByRole('complementary', { name: 'Walk in' });
  await expect(booking.getByRole('heading', { name: 'Walk in: Session' })).toBeVisible();
  return { booking, desk };
}

test('a walk in on file is booked and checked in in one action, after the tick', async ({
  page,
}) => {
  const patient = await testPatient();
  const { booking, desk } = await walkInSheet(page);
  await booking.getByLabel('Mobile or name').fill(patient.phone.slice(-10));
  await booking.getByRole('button', { name: 'Search' }).click();
  const book = booking.getByRole('button', { name: `Book and check in ${patient.name}` });
  await book.click();
  await expect(booking.getByRole('alert')).toHaveText('Tick that you have checked who this is.');
  expect(await appointmentsOf(patient.id)).toEqual([]);

  // Ticked before searching again: the tick stays.
  await booking.getByLabel(tick).check();
  await booking.getByRole('button', { name: 'Search' }).click();
  await expect(page).toHaveURL(/ticked=1/);
  await expect(booking.getByLabel(tick)).toBeChecked();
  await book.click();
  await expect(page).toHaveURL(/\/app\/today\?.*done=checked-in/);
  await expect(page.getByTestId('check-in-done')).toHaveText('Checked in.');
  await expect(drawer(page).getByTestId('checked-in')).toContainText(`by ${desk.name}`);
  await expect(page.getByTestId('today-row').filter({ hasText: patient.name })).toBeVisible();
  expect(await appointmentsOf(patient.id)).toEqual([
    { channel: 'walk_in', bookedBy: desk.id, status: 'checked_in', checkedInBy: desk.id },
  ]);
});

test('a new walk in is added, booked and checked in in one action', async ({ page }) => {
  const { booking, desk } = await walkInSheet(page);
  const name = fakeName('Test Walk In');
  await booking.getByLabel(tick).check();
  await booking.getByLabel('Name', { exact: true }).fill(name);
  await booking.getByLabel('Mobile', { exact: true }).fill(fakeMobile().slice(3));
  await booking.getByRole('button', { name: 'Add, book and check in' }).click();
  await expect(page).toHaveURL(/\/app\/today\?.*done=checked-in/);
  await expect(drawer(page)).toContainText(name);
  await expect(drawer(page).getByTestId('checked-in')).toContainText(`by ${desk.name}`);
});
