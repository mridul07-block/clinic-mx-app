import { istDate } from '@clinic-mx/schemas';
import { expect, test } from '@playwright/test';
import { startedAppointment, removeCalendarRows } from './calendar';
import { removePipelineRows } from './intake';
import { checkedIn, consultationTypeId, submittedWithAlert } from './my-patients';
import { testPatient } from './patients';
import { signIn, signInWithCode, temporaryDesk, temporaryWithCode } from './staff';

// CLN-01 done when: the physio's home lists their visits today in time order with status, form
// status and alerts ("Preparation sheet ready" comes with AI-03). Decisions (user, 24 October
// 2026): Start marks a checked in visit In progress ("With physio" on Today), only by its own
// physio; the list updates by itself. Each test has its own temporary physio at HSR Layout.

const physios: string[] = [];
const visits: string[] = [];
test.afterEach(async () => {
  await removePipelineRows(visits.splice(0));
  if (physios.length) await removeCalendarRows(physios.splice(0));
});

test('the physio lands on their visits in time order, starts one, and sees a check in live', async ({
  page,
  browser,
}) => {
  const physio = await temporaryWithCode('physiotherapist', ['HSR Layout']);
  physios.push(physio.id);
  const [late, here, later] = [await testPatient(), await testPatient(), await testPatient()];
  const lateVisit = await startedAppointment(physio.id, late.id, 20, { minutes: 5 });
  const hereVisit = await startedAppointment(physio.id, here.id, 5, {
    minutes: 5,
    values: { appointmentTypeId: await consultationTypeId() },
  });
  const laterVisit = await startedAppointment(physio.id, later.id, -30, { minutes: 5 });
  visits.push(lateVisit.id, hereVisit.id, laterVisit.id);
  test.skip(
    istDate(lateVisit.startsAt) !== istDate(laterVisit.startsAt),
    'The visits fall on two days in IST around midnight.',
  );
  const desk = await temporaryDesk();
  await checkedIn(hereVisit.id, desk.id);
  await submittedWithAlert(hereVisit.id, here.id);

  await signInWithCode(page, physio.email, physio.secret);
  await expect(page).toHaveURL(/\/app\/my-patients$/);
  await expect(page.getByRole('heading', { name: 'My patients today', exact: true })).toBeVisible();
  const rows = page.getByTestId('my-patient');
  await expect
    .poll(() => rows.evaluateAll((all) => all.map((row) => row.getAttribute('data-appointment'))))
    .toEqual([lateVisit.id, hereVisit.id, laterVisit.id]);
  const row = (name: string) => rows.filter({ hasText: name });
  await expect(row(late.name)).toContainText('Running late');
  await expect(row(late.name).getByTestId('form-status')).toHaveText('Form: Not sent');
  await expect(row(late.name).getByRole('button')).toHaveCount(0);
  await expect(row(here.name)).toContainText(/Here \d+ min/);
  await expect(row(here.name).getByTestId('form-status')).toHaveText('Form: Submitted');
  await expect(row(here.name).getByTestId('visit-alerts')).toHaveText('1 open red flag alert');
  await expect(row(later.name)).toContainText('Booked');

  await row(here.name)
    .getByRole('button', { name: `Start consultation for ${here.name}` })
    .click();
  await expect(row(here.name)).toContainText(/With you since \d\d:\d\d/);
  await expect(row(here.name).getByRole('button')).toHaveCount(0);

  // The desk checks the later patient in: it shows here without a reload.
  await checkedIn(laterVisit.id, desk.id);
  await expect(row(later.name)).toContainText(/Here \d+ min/, { timeout: 15_000 });
  await expect(row(later.name).getByRole('button', { name: /^Start session/ })).toBeVisible();

  // On the front desk's Today, the started one is with the physio.
  const deskPage = await (await browser.newContext()).newPage();
  await signIn(deskPage, desk.email);
  await deskPage.goto('/app/today');
  await expect(deskPage.getByTestId('today-row').filter({ hasText: here.name })).toContainText(
    'In progress',
  );
  // The desk has no My patients today.
  await deskPage.goto('/app/my-patients');
  await expect(deskPage).toHaveURL(/\/app\/not-allowed/);
  await deskPage.context().close();
});

test('a physio with nobody booked today is told so', async ({ page }) => {
  const physio = await temporaryWithCode('physiotherapist', ['HSR Layout']);
  physios.push(physio.id);
  await signInWithCode(page, physio.email, physio.secret);
  await expect(page).toHaveURL(/\/app\/my-patients$/);
  await expect(page.getByText('No patients booked with you today.')).toBeVisible();
  await page.goto('/app');
  await expect(page.getByTestId('home-my-patients')).toHaveText('My patients today');
});
