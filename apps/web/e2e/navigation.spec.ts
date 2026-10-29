import { expect, test, type Page } from '@playwright/test';
import { removeCalendarRows, startedAppointment } from './calendar';
import { signedConsultation } from './consultations';
import { removePipelineRows } from './intake';
import { consultationTypeId, submittedWithAlert } from './my-patients';
import { testPatient } from './patients';
import { signIn, signInWithCode, temporaryDesk, temporaryWithCode } from './staff';

// UI-01 done when: each role's tabs from Frontend Specification section 4 on phones. Recommended
// defaults under the user's standing approval (29 October 2026): the specification's words, then
// More (Home); a tab only for those who may open its screen; phones only; hidden in a
// consultation, which pins its own buttons.

const physios: string[] = [];
const visits: string[] = [];
test.afterEach(async () => {
  await removePipelineRows(visits.splice(0));
  if (physios.length) await removeCalendarRows(physios.splice(0));
});

const onPhone = () => test.info().project.name === 'phone';
const bar = (page: Page) => page.getByTestId('phone-tab-bar');

/** On a phone: the role's tabs in order, the landing tab current; on a desktop: no bar. */
async function expectTabs(page: Page, labels: string[], current: string) {
  if (!onPhone()) {
    await expect(bar(page)).toBeHidden();
    return;
  }
  await expect(bar(page).getByRole('link')).toHaveText(labels);
  await expect(bar(page).getByRole('link', { name: current, exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await expect(bar(page).locator('[aria-current="page"]')).toHaveCount(1);
  const fits = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
  expect(fits).toBe(true);
}

/** More goes Home and is then the current tab. */
async function moreGoesHome(page: Page) {
  if (!onPhone()) return;
  await bar(page).getByRole('link', { name: 'More', exact: true }).click();
  await expect(page).toHaveURL(/\/app$/);
  await expect(bar(page).getByRole('link', { name: 'More', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  );
}

test('the Front Desk has Today, Calendar and Patients, and a tab goes to its screen', async ({
  page,
}) => {
  const desk = await temporaryDesk();
  await signIn(page, desk.email);
  await expect(page).toHaveURL(/\/app\/today/);
  await expectTabs(page, ['Today', 'Calendar', 'Patients', 'More'], 'Today');
  await page.screenshot({ path: test.info().outputPath('desk-tabs.png') });
  if (onPhone()) {
    await bar(page).getByRole('link', { name: 'Patients', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Patients', level: 1 })).toBeVisible();
    await expect(bar(page).getByRole('link', { name: 'Patients', exact: true })).toHaveAttribute(
      'aria-current',
      'page',
    );
  }
  await moreGoesHome(page);
});

test('a physio has My patients, Today and Notes; the bar stands aside in a consultation', async ({
  page,
}) => {
  test.slow();
  const physio = await temporaryWithCode('physiotherapist', ['HSR Layout'], { consultant: true });
  physios.push(physio.id);
  const patient = await testPatient();
  const seen = await startedAppointment(physio.id, patient.id, 60, {
    minutes: 45,
    values: {
      appointmentTypeId: await consultationTypeId(),
      status: 'completed',
      completedAt: new Date(),
    },
  });
  visits.push(seen.id);
  await submittedWithAlert(seen.id, patient.id);
  const { consultationId } = await signedConsultation(seen.id, physio.id);

  await signInWithCode(page, physio.email, physio.secret);
  await expect(page).toHaveURL(/\/app\/my-patients/);
  await expectTabs(page, ['My patients', 'Today', 'Notes', 'More'], 'My patients');
  if (onPhone()) {
    await bar(page).getByRole('link', { name: 'Notes', exact: true }).click();
    await expect(page).toHaveURL(/\/app\/tasks/);
  }

  // The consultation pins Back and Next at the bottom; the bar comes back on Explain to patient.
  await page.goto(`/app/consultations/${consultationId}`);
  await expect(page.locator('#consultation-step')).toBeVisible();
  await expect(bar(page)).toHaveCount(0);
  await page.getByTestId('explain-link').click();
  await expect(page).toHaveURL(/\/explain$/);
  if (onPhone()) await expect(bar(page)).toBeVisible();
  await moreGoesHome(page);
});

test('a Centre Manager has the dashboard’s Alerts, Centres and Outcomes', async ({ page }) => {
  const manager = await temporaryWithCode('centre_manager', ['HSR Layout']);
  await signInWithCode(page, manager.email, manager.secret);
  await expect(page).toHaveURL(/\/app\/dashboard\/alerts/);
  await expectTabs(page, ['Alerts', 'Centres', 'Outcomes', 'More'], 'Alerts');
  await moreGoesHome(page);
});

test('Finance has Bills, Unpaid and Packages; Revenue counts as Bills', async ({ page }) => {
  const finance = await temporaryWithCode('finance');
  await signInWithCode(page, finance.email, finance.secret);
  await expect(page).toHaveURL(/\/app\/finance\/collections/);
  await expectTabs(page, ['Bills', 'Unpaid', 'Packages', 'More'], 'Bills');
  await page.goto('/app/finance/revenue');
  await expectTabs(page, ['Bills', 'Unpaid', 'Packages', 'More'], 'Bills');
  await moreGoesHome(page);
});

test('the Super Admin has Overview, Alerts and Settings', async ({ page }) => {
  const admin = await temporaryWithCode('super_admin');
  await signInWithCode(page, admin.email, admin.secret);
  await expect(page).toHaveURL(/\/app\/overview/);
  await expectTabs(page, ['Overview', 'Alerts', 'Settings', 'More'], 'Overview');
  await moreGoesHome(page);
});
