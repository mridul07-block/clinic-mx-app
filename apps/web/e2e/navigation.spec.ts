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

const side = (page: Page) => page.getByTestId('side-nav');

/**
 * On a phone: the role's tabs in order, the landing tab current, no sidebar. On a desktop (UI-02):
 * no tabs; the sidebar with the landing screen current.
 */
async function expectTabs(page: Page, labels: string[], current: string, sidebar: string) {
  if (!onPhone()) {
    await expect(bar(page)).toBeHidden();
    await expect(side(page)).toBeVisible();
    await expect(side(page).locator('[aria-current="page"]')).toHaveAccessibleName(sidebar);
    return;
  }
  await expect(side(page)).toBeHidden();
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
  await expectTabs(page, ['Today', 'Calendar', 'Patients', 'More'], 'Today', 'Today');
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
  await expectTabs(
    page,
    ['My patients', 'Today', 'Notes', 'More'],
    'My patients',
    'My patients today',
  );
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
  await expectTabs(page, ['Alerts', 'Centres', 'Outcomes', 'More'], 'Alerts', 'Dashboard');
  await moreGoesHome(page);
});

test('Finance has Bills, Unpaid and Packages; Revenue counts as Bills', async ({ page }) => {
  const finance = await temporaryWithCode('finance');
  await signInWithCode(page, finance.email, finance.secret);
  await expect(page).toHaveURL(/\/app\/finance\/collections/);
  await expectTabs(page, ['Bills', 'Unpaid', 'Packages', 'More'], 'Bills', 'Finance');
  await page.goto('/app/finance/revenue');
  await expectTabs(page, ['Bills', 'Unpaid', 'Packages', 'More'], 'Bills', 'Finance');
  await moreGoesHome(page);
});

test('the Super Admin has Overview, Alerts and Settings', async ({ page }) => {
  const admin = await temporaryWithCode('super_admin');
  await signInWithCode(page, admin.email, admin.secret);
  await expect(page).toHaveURL(/\/app\/overview/);
  await expectTabs(page, ['Overview', 'Alerts', 'Settings', 'More'], 'Overview', 'Overview');
  await moreGoesHome(page);
});

test('from 1280 px the Super Admin jumps with Ctrl K and switches the centre Today opens on', async ({
  page,
}) => {
  test.skip(onPhone(), 'The sidebar and Search or jump to are for tablets and desktops (UI-02).');
  const admin = await temporaryWithCode('super_admin');
  await signInWithCode(page, admin.email, admin.secret);
  await expect(side(page)).toBeVisible();
  for (const section of ['Day to day', 'Clinical', 'Figures', 'Setup']) {
    await expect(side(page).locator('p').getByText(section, { exact: true })).toBeVisible();
  }

  // Search or jump to: words of a screen, then Enter.
  await page.keyboard.press('Control+k');
  const search = page.getByRole('combobox', { name: 'Search or jump to' });
  await expect(search).toBeFocused();
  await search.fill('audit');
  await expect(page.getByRole('dialog').getByRole('option')).toHaveText([
    'Audit log',
    'Find patients: audit',
  ]);
  await search.press('Enter');
  await expect(page).toHaveURL(/\/app\/audit$/);
  await expect(side(page).getByRole('link', { name: 'Audit log' })).toHaveAttribute(
    'aria-current',
    'page',
  );
  // A patient search goes to Patients with the words.
  await side(page).getByRole('button', { name: 'Search or jump to' }).click();
  await search.fill('Test Nobody');
  await page
    .getByRole('dialog')
    .getByRole('option', { name: 'Find patients: Test Nobody' })
    .click();
  await expect(page).toHaveURL(/\/app\/patients\?q=Test\+Nobody/);

  // The centre switcher: Today opens on the centre chosen.
  await page.goto('/app/today');
  await side(page).getByLabel('Centre').selectOption({ label: 'Koramangala' });
  const opened = (name: string) =>
    page.getByRole('navigation', { name: 'Centre' }).getByRole('link', { name, exact: true });
  await expect(opened('Koramangala')).toHaveAttribute('aria-current', 'page');
  // Kept on this device: Today opens on it again, until an address names another centre.
  await page.goto('/app/today');
  await expect(opened('Koramangala')).toHaveAttribute('aria-current', 'page');
  await expect(side(page).getByLabel('Centre').locator('option:checked')).toHaveText('Koramangala');
  await page.screenshot({ path: test.info().outputPath('sidebar.png') });

  // The person's menu: Account and Sign out.
  await side(page).getByTestId('person-menu').locator('summary').click();
  await expect(side(page).getByRole('link', { name: 'Account' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(side(page).getByRole('link', { name: 'Account' })).toBeHidden();
  // Signing out forgets the choice: the next person on this device starts afresh.
  await side(page).getByTestId('person-menu').locator('summary').click();
  await side(page).getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/app\/sign-in/);
  const left = await page.context().cookies();
  expect(left.map((cookie) => cookie.name)).not.toContain('cmx_centre');
});

test('a centre chosen by someone else on this device never opens for a person who does not work there', async ({
  page,
  baseURL,
}) => {
  test.skip(onPhone(), 'The centre switcher is in the sidebar (UI-02).');
  const desk = await temporaryDesk();
  // Whitefield, left on a shared desk computer; this desk works at HSR Layout only. Both the
  // cookie's own check and row level security on centres keep it out (a check at each layer).
  await page.context().addCookies([
    {
      name: 'cmx_centre',
      value: '00000000-0000-4000-8000-000000000103',
      url: new URL('/app', baseURL).toString(),
    },
  ]);
  await signIn(page, desk.email);
  await expect(page.getByRole('main')).toContainText('HSR Layout ·');
  const current = page.getByRole('navigation', { name: 'Centre' }).locator('[aria-current="page"]');
  await page.goto('/app/calendar');
  await expect(page.getByRole('heading', { name: 'Calendar', exact: true })).toBeVisible();
  if (await current.count()) await expect(current).toHaveText('HSR Layout');
  // One centre: no switcher.
  await expect(side(page).getByTestId('centre-switcher')).toHaveCount(0);
});

test('from 768 px a rail of icons, each named, the current one marked', async ({ page }) => {
  test.skip(onPhone(), 'The rail is for tablets (UI-02).');
  const desk = await temporaryDesk();
  await page.setViewportSize({ width: 1024, height: 768 });
  await signIn(page, desk.email);
  await expect(side(page)).toBeVisible();
  const rail = await side(page).boundingBox();
  expect(rail?.width).toBe(64);
  // Icons only with a mouse: each link fits the rail, its name for tooltips and screen readers.
  const calendar = side(page).getByRole('link', { name: 'Calendar', exact: true });
  await expect(calendar).toBeVisible();
  await expect(calendar).toHaveAttribute('title', 'Calendar');
  expect((await calendar.boundingBox())?.width).toBeLessThanOrEqual(48);
  await expect(side(page).locator('[aria-current="page"]')).toHaveAccessibleName('Today');
  const fits = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
  expect(fits).toBe(true);
  await page.screenshot({ path: test.info().outputPath('rail.png') });
});
