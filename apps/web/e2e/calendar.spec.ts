import { addDays, istDate } from '@clinic-mx/schemas';
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { centreIdByCode, physioAtHsr, removeCalendarRows, testAppointment } from './calendar';
import { testPatient } from './patients';
import {
  signIn,
  signInWithCode,
  temporaryDesk,
  temporarySuperAdmin,
  temporaryWithCode,
} from './staff';

// SCH-05 done when: a column per physio, the fee in the header, free slots clickable, live
// updates and drawer details. Decisions (user, 22 October 2026): the calendar checks for changes
// every 3 seconds until the realtime relay; a free slot opens the drawer with the types that fit;
// the header shows a consultant's own consultation fee. Each test has its own temporary physio
// at HSR Layout, a week ahead, and removes their appointments and hours afterwards.
//
// SCH-06 done when: at 360 px the calendar is an agenda, one physio or everyone at a time, with
// details in a bottom sheet. Decisions (user, 23 October 2026): a phone opens on Everyone by time;
// free time shows in one physio's agenda. The phone project checks the agenda, the desktop the grid.

const day = addDays(istDate(new Date()), 7);
const made: string[] = [];
test.afterEach(async () => {
  if (made.length) await removeCalendarRows(made.splice(0));
});

async function openCalendar(page: Page) {
  const hsr = await centreIdByCode('HSR');
  await page.goto(`/app/calendar?centre=${hsr}&date=${day}`);
  await expect(page.getByRole('heading', { name: 'Calendar', exact: true })).toBeVisible();
}

const column = (page: Page, name: string) =>
  page.getByTestId('physio-column').filter({ hasText: name });

const onPhone = (testInfo: TestInfo) => testInfo.project.name === 'phone';

/** An appointment: a row of the agenda on a phone, a block of the grid on a desktop. */
const appointmentAt = (page: Page, testInfo: TestInfo, patientName: string) =>
  page
    .getByTestId(onPhone(testInfo) ? 'agenda-row' : 'calendar-block')
    .filter({ hasText: patientName });

/** Where a physio's name, Consultant tag and fee show: their agenda on a phone, picked by its chip. */
async function physioHeader(page: Page, testInfo: TestInfo, name: string) {
  if (!onPhone(testInfo)) return column(page, name);
  const chips = page.getByRole('navigation', { name: 'Physio' });
  if (await chips.count()) await chips.getByRole('link', { name, exact: true }).click();
  const agenda = page.getByTestId('agenda');
  await expect(agenda.getByRole('heading', { name, exact: true })).toBeVisible();
  return agenda;
}

test('the front desk sees each physio’s fee, appointments and free slots', async ({
  page,
}, testInfo) => {
  const physio = await temporaryWithCode('physiotherapist', ['HSR Layout']);
  const colleague = await temporaryWithCode('physiotherapist', ['HSR Layout']);
  made.push(physio.id, colleague.id);
  await physioAtHsr(physio.id, { consultant: true, feeKey: 'consultation' });
  await physioAtHsr(colleague.id);
  const patient = await testPatient();
  const number = await testAppointment(physio.id, patient.id, day, 10 * 60);
  const desk = await temporaryDesk();
  await signIn(page, desk.email);

  await page.getByRole('link', { name: 'Calendar' }).click();
  await expect(page.getByRole('heading', { name: 'Calendar', exact: true })).toBeVisible();
  await openCalendar(page);
  const block = appointmentAt(page, testInfo, patient.name);
  if (onPhone(testInfo)) {
    // Everyone, by time: each row names its physio; nothing scrolls the page sideways.
    await expect(page.getByRole('link', { name: 'Everyone', exact: true })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await expect(block).toContainText(physio.name);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      360,
    );
  }
  const header = await physioHeader(page, testInfo, physio.name);
  await expect(header).toContainText('Consultant');
  await expect(header).toContainText('Consultation ₹750');

  await expect(block).toContainText('Session');
  await expect(block).toContainText('Booked');
  await block.click();
  const drawer = page.getByTestId('calendar-drawer');
  if (onPhone(testInfo)) {
    // A sheet across the bottom of the screen.
    await expect
      .poll(async () => {
        const box = await drawer.boundingBox();
        return box && [Math.round(box.x), Math.round(box.width), Math.round(box.y + box.height)];
      })
      .toEqual([0, 360, 800]);
  }
  await expect(drawer).toContainText(number);
  await expect(drawer).toContainText('10:00 to 10:45');
  await expect(drawer).toContainText(`${physio.name} at HSR Layout`);
  await expect(drawer).toContainText('WhatsApp');
  await expect(drawer.getByRole('link', { name: patient.name })).toHaveAttribute(
    'href',
    `/app/patients/${patient.id}`,
  );
  await drawer.getByRole('link', { name: 'Close' }).click();
  await expect(drawer).toHaveCount(0);

  // 10:00 is taken; 11:00 is free and opens the slot drawer with what fits there.
  await expect(page.getByRole('link', { name: `Free at 10:00 with ${physio.name}` })).toHaveCount(
    0,
  );
  await page.getByRole('link', { name: `Free at 11:00 with ${physio.name}` }).click();
  await expect(drawer).toContainText(`Free at 11:00 with ${physio.name}`);
  const options = drawer.getByTestId('slot-options');
  await expect(options.getByRole('listitem').filter({ hasText: 'Session' })).toContainText(
    'Fits, 45 min',
  );
  await expect(options.getByRole('listitem').filter({ hasText: 'Consultation' })).toContainText(
    'Fits',
  );
  await page.keyboard.press('Escape');
  await expect(drawer).toHaveCount(0);
});

test('a booking made elsewhere appears without a reload', async ({ page }, testInfo) => {
  const physio = await temporaryWithCode('physiotherapist', ['HSR Layout']);
  made.push(physio.id);
  await physioAtHsr(physio.id);
  const desk = await temporaryDesk();
  await signIn(page, desk.email);
  await openCalendar(page);
  if (!onPhone(testInfo)) await expect(column(page, physio.name)).toBeVisible();
  await expect(page.getByTestId('live-status')).toContainText('Live, updated');
  await page.evaluate(() => {
    (window as { notReloaded?: boolean }).notReloaded = true;
  });

  const patient = await testPatient();
  await testAppointment(physio.id, patient.id, day, 11 * 60 + 30);
  await expect(appointmentAt(page, testInfo, patient.name)).toBeVisible({ timeout: 10_000 });
  expect(await page.evaluate(() => (window as { notReloaded?: boolean }).notReloaded)).toBe(true);
});

test('a physio sees only their own column, without fees', async ({ page }, testInfo) => {
  const physio = await temporaryWithCode('physiotherapist', ['HSR Layout']);
  const colleague = await temporaryWithCode('physiotherapist', ['HSR Layout']);
  made.push(physio.id, colleague.id);
  await physioAtHsr(physio.id, { consultant: true, feeKey: 'consultation' });
  await physioAtHsr(colleague.id);
  await signInWithCode(page, physio.email, physio.secret);
  await openCalendar(page);
  await expect(page.getByTestId('physio-column')).toHaveCount(1);
  await expect(page.getByRole('navigation', { name: 'Physio' })).toHaveCount(0);
  const header = await physioHeader(page, testInfo, physio.name);
  await expect(header).toContainText('Consultant');
  await expect(header).not.toContainText('₹');
  await expect(page.getByTestId('physio-fee')).toHaveCount(0);
});

test('Finance has no calendar', async ({ page }) => {
  const finance = await temporaryWithCode('finance');
  await signInWithCode(page, finance.email, finance.secret);
  await expect(page.getByRole('link', { name: 'Calendar' })).toHaveCount(0);
  await page.goto('/app/calendar');
  await expect(page).toHaveURL(/\/app\/not-allowed/);
});

test('the Super Admin sets a consultant’s consultation fee', async ({ page }, testInfo) => {
  const physio = await temporaryWithCode('physiotherapist', ['HSR Layout']);
  made.push(physio.id);
  await physioAtHsr(physio.id, { consultant: true });
  const admin = await temporarySuperAdmin({ support: false });
  await signInWithCode(page, admin.email, admin.secret);
  await page.goto(`/app/staff/${physio.id}`);
  const fee = page.getByRole('group', { name: /Set by their level/ });
  await expect(fee.getByRole('radio', { name: 'Not set' })).toBeChecked();
  await fee.getByRole('radio', { name: 'Senior consultation ₹1,000' }).check();
  await page.getByRole('button', { name: 'Save fee' }).click();
  await expect(page.getByText('Consultation fee saved.')).toBeVisible();
  await openCalendar(page);
  await expect(await physioHeader(page, testInfo, physio.name)).toContainText(
    'Senior consultation ₹1,000',
  );
});
