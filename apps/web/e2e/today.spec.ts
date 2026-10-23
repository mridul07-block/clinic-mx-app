import { istDate } from '@clinic-mx/schemas';
import { expect, test, type Page } from '@playwright/test';
import { removeCalendarRows, startedAppointment } from './calendar';
import { testPatient } from './patients';
import { signIn, signInWithCode, temporaryDesk, temporaryWithCode } from './staff';

// INT-01 done when: the front desk Today board has count chips that filter, status tags, waiting
// timers, live updates and an emergency banner slot. Decisions (user, 23 October 2026): Check in
// in one tap with Undo the same day; Done is Completed and No show, Cancelled and Rescheduled are
// left off; the Front Desk lands on Today. Other tests share HSR Layout today, so each test finds
// its own generated patients' rows; appointments are written directly at today's times, five
// minutes long, for a temporary physio, removed afterwards.

const made: string[] = [];
test.afterEach(async () => {
  if (made.length) await removeCalendarRows(made.splice(0));
});

async function physio() {
  const person = await temporaryWithCode('physiotherapist', ['HSR Layout']);
  made.push(person.id);
  return person;
}

const rowOf = (page: Page, patientName: string) =>
  page.getByTestId('today-row').filter({ hasText: patientName });

const chip = (page: Page, name: string) =>
  page.getByRole('group', { name: 'Show' }).locator(`[data-filter="${name}"]`);

/** A chip's count, as it reads. */
const countOf = async (page: Page, name: string) =>
  Number((await chip(page, name).innerText()).replace(/\D+/g, ''));

test('the desk lands on Today; chips count and filter; tags and timers show', async ({ page }) => {
  const person = await physio();
  const later = await testPatient();
  const late = await testPatient();
  const here = await testPatient();
  const done = await testPatient();
  const dropped = await testPatient();
  const upcoming = await startedAppointment(person.id, later.id, -120, { minutes: 5 });
  // An appointment after 22:00 IST would be tomorrow's; the board is today's.
  test.skip(istDate(upcoming.startsAt) !== istDate(new Date()), 'Too late in the IST day.');
  await startedAppointment(person.id, late.id, 20, {
    minutes: 5,
    values: { status: 'confirmed', confirmedAt: new Date() },
  });
  await startedAppointment(person.id, here.id, 10, {
    minutes: 5,
    values: { status: 'checked_in', arrivedAt: new Date(Date.now() - 12 * 60_000) },
  });
  await startedAppointment(person.id, done.id, 40, { minutes: 5, values: { status: 'completed' } });
  const desk = await temporaryDesk();
  await startedAppointment(person.id, dropped.id, 60, {
    minutes: 5,
    values: {
      status: 'cancelled',
      changeReason: 'patient',
      changedAt: new Date(),
      changedBy: desk.id,
    },
  });

  await signIn(page, desk.email);
  await expect(page).toHaveURL(/\/app\/today$/);
  await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
  await expect(page.getByText(`Signed in as ${desk.name}, Front Desk`)).toBeVisible();

  await expect(rowOf(page, later.name)).toContainText('Booked');
  await expect(rowOf(page, late.name)).toContainText('Running late');
  await expect(rowOf(page, late.name)).toContainText(/2\d min late/);
  await expect(rowOf(page, here.name)).toContainText(/Here 1[2-3] min/);
  await expect(rowOf(page, done.name)).toContainText('Completed');
  await expect(rowOf(page, dropped.name)).toHaveCount(0);
  expect(await countOf(page, 'here')).toBeGreaterThanOrEqual(1);
  expect(await countOf(page, 'to_arrive')).toBeGreaterThanOrEqual(2);

  await chip(page, 'here').click();
  await expect(chip(page, 'here')).toHaveAttribute('aria-pressed', 'true');
  await expect(rowOf(page, here.name)).toBeVisible();
  await expect(rowOf(page, late.name)).toHaveCount(0);
  await expect(page.getByTestId('today-row')).toHaveCount(await countOf(page, 'here'));
  await expect(page).toHaveURL(/show=here/);

  await chip(page, 'not_confirmed').click();
  await expect(rowOf(page, later.name)).toBeVisible();
  await expect(rowOf(page, late.name)).toHaveCount(0);

  await chip(page, 'done').click();
  await expect(rowOf(page, done.name)).toBeVisible();
  await expect(rowOf(page, later.name)).toHaveCount(0);
});

test('the desk checks a patient in in one tap and undoes a mistake', async ({ page }) => {
  const person = await physio();
  const patient = await testPatient();
  await startedAppointment(person.id, patient.id, 20, {
    minutes: 5,
    values: { status: 'confirmed', confirmedAt: new Date() },
  });
  const desk = await temporaryDesk();
  await signIn(page, desk.email);

  const row = rowOf(page, patient.name);
  await expect(row).toContainText('Running late');
  await row.getByRole('button', { name: `Check in ${patient.name}` }).click();
  await expect(row).toContainText('Here 0 min');
  await expect(row).not.toContainText('min late');
  await chip(page, 'here').click();
  await expect(row).toBeVisible();

  await row.getByRole('button', { name: `Undo check in for ${patient.name}` }).click();
  // Back on the Here now chip, where it no longer is; then under To arrive, running late again.
  await expect(row).toHaveCount(0);
  await chip(page, 'to_arrive').click();
  await expect(row).toContainText('Running late');
});

test('an appointment booked elsewhere appears without a reload', async ({ page }) => {
  const person = await physio();
  const desk = await temporaryDesk();
  await signIn(page, desk.email);
  await expect(page.getByTestId('live-status')).toContainText('Live');

  const patient = await testPatient();
  await startedAppointment(person.id, patient.id, 5, { minutes: 5 });
  await expect(rowOf(page, patient.name)).toContainText('Booked', { timeout: 15_000 });
});

test('Physio and Finance cannot open Today', async ({ page }) => {
  const person = await physio();
  await signInWithCode(page, person.email, person.secret);
  await page.goto('/app/today');
  await expect(page).toHaveURL(/\/app\/not-allowed/);

  const finance = await temporaryWithCode('finance');
  await page.context().clearCookies();
  await signInWithCode(page, finance.email, finance.secret);
  await page.goto('/app/today');
  await expect(page).toHaveURL(/\/app\/not-allowed/);
});

test('the emergency banner is full width and red', async ({ page }) => {
  const desk = await temporaryDesk();
  await signIn(page, desk.email);
  await page.goto('/app/test-harness/emergency-banner');
  const banner = page.getByTestId('emergency-banner');
  await expect(banner).toContainText('Clinician review needed before Test Patient Harness leaves.');
  await expect(banner.getByRole('link', { name: 'Open patient' })).toBeVisible();
  const box = await banner.boundingBox();
  expect(box?.width).toBe(page.viewportSize()?.width);
  // Solid red, the one place it is used (Frontend Specification, status colours).
  await expect(banner).toHaveClass(/bg-danger-strong/);
});
