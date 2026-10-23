import { istDate } from '@clinic-mx/schemas';
import { expect, test, type Browser, type Page } from '@playwright/test';
import { centreIdByCode, removeCalendarRows, startedAppointment } from './calendar';
import { aboutYou, reportsOf, savedForm, signConsent, submittedOf } from './intake';
import { testLink } from './patient-links';
import { testPatient } from './patients';
import { signIn, temporaryDesk, temporaryWithCode } from './staff';

// INT-05 done when: every PRD J2.3 screen, the body chart and the pain sliders included; about 5
// minutes on a phone. Decisions (user, 23 October 2026): the whole body chart, front and back;
// pain 0 to 10 with "No pain" and "Worst pain you can imagine"; report photos the patient adds go
// to the same reports the desk sees; only the warning signs, the health check, the region and
// gender must be answered. Check and submit reads the answers back and submits once. Each test
// has its own temporary physio and a generated patient's visit, checked in a few minutes ago.

const made: string[] = [];
test.afterEach(async () => {
  if (made.length) await removeCalendarRows(made.splice(0));
});

async function visitLink(patient: Awaited<ReturnType<typeof testPatient>>) {
  const physio = await temporaryWithCode('physiotherapist', ['HSR Layout']);
  made.push(physio.id);
  const visit = await startedAppointment(physio.id, patient.id, 3, {
    minutes: 5,
    values: { status: 'checked_in', arrivedAt: new Date(), checkedInBy: physio.id },
  });
  test.skip(istDate(visit.startsAt) !== istDate(new Date()), 'Just after midnight in IST.');
  const link = await testLink({
    purpose: 'health_form',
    patientId: patient.id,
    appointmentId: visit.id,
  });
  return { visit, path: link.path };
}

/** Another browser like this project's, the patient's phone; scripts on unless asked. */
async function phone(browser: Browser, javaScriptEnabled = true): Promise<Page> {
  const { viewport, isMobile, hasTouch, userAgent, deviceScaleFactor, baseURL } =
    test.info().project.use;
  const context = await browser.newContext({
    viewport,
    isMobile,
    hasTouch,
    userAgent,
    deviceScaleFactor,
    baseURL,
    javaScriptEnabled,
  });
  return context.newPage();
}

const question = (page: Page, text: string) => page.getByRole('group', { name: text });
const next = (page: Page) => page.getByRole('button', { name: 'Next' }).click();
const at = (page: Page, screen: string) =>
  expect.poll(() => new URL(page.url()).searchParams.get('screen')).toBe(screen);
const onePixelPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

/** Warning signs: No to every question, 0 to a number one. */
async function noWarningSigns(page: Page) {
  await at(page, 'warning_signs');
  for (const group of await page.getByRole('group').all()) {
    const no = group.getByText('No', { exact: true });
    if ((await no.count()) > 0 && (await no.isVisible())) await no.click();
  }
  const minutes = page.getByLabel(/how many minutes does it last/);
  if ((await minutes.count()) > 0) await minutes.fill('0');
  await next(page);
}

test('the whole form: every screen, the chart and sliders, a report photo, then submit', async ({
  page,
}) => {
  const patient = await testPatient({ sex: 'female', occupation: 'Teacher' });
  const { visit, path } = await visitLink(patient);
  const started = Date.now();
  await page.goto(path);
  await page.getByRole('link', { name: 'Start' }).click();
  await signConsent(page);

  // About you starts from the record.
  await expect(question(page, 'Gender').getByRole('radio', { name: 'Female' })).toBeChecked();
  await expect(page.getByLabel('Occupation')).toHaveValue('Teacher');
  await next(page);

  // Your problem: the region, the chart, the sliders; the rest may be left.
  await at(page, 'problem');
  await question(page, 'Body region').getByText('Knee', { exact: true }).click();
  await page.getByTitle('Right knee, front').click();
  await page.getByTitle('Right knee, back').click();
  await expect(page.getByRole('checkbox', { name: 'Right knee, front' })).toBeChecked();
  const painNow = question(page, 'Pain now (optional)');
  await expect(painNow).toContainText('0 No pain');
  await expect(painNow).toContainText('10 Worst pain you can imagine');
  await expect(painNow.getByTestId('scale-readout')).toHaveText('Not answered yet');
  await painNow.getByRole('slider').fill('6');
  await expect(painNow.getByTestId('scale-readout')).toHaveText('6 out of 10');
  await page.getByLabel('Main complaint').fill('Pain going down stairs');
  await question(page, 'Onset (optional)').getByText('Gradual (slow)').click();
  await next(page);

  await noWarningSigns(page);

  // Health check: pregnancy shows for female; None of these goes alone.
  await at(page, 'health_check');
  const conditions = question(page, 'Tick any that apply');
  await expect(conditions.getByText('Pregnancy / breastfeeding')).toBeVisible();
  await next(page);
  await expect(conditions).toContainText('Answer this question.');
  await conditions.getByText('None of these', { exact: true }).click();
  await conditions.getByText('Diabetes', { exact: true }).click();
  await next(page);
  await expect(conditions).toContainText('Choose None of these, or the ones that apply.');
  await conditions.getByText('None of these', { exact: true }).click();
  await next(page);

  // Activity: Other (specify) shows when Other is ticked.
  await at(page, 'activity');
  const activity = question(page, 'Activity (optional)');
  await expect(page.getByLabel('Other (specify) (optional)')).toBeHidden();
  await activity.getByText('Running', { exact: true }).click();
  await activity.getByText('Other (specify)', { exact: true }).click();
  await page.getByLabel('Other (specify) (optional)').fill('Frisbee');
  await next(page);

  // History with a report photo.
  await at(page, 'history');
  await page.getByLabel('Add a photo of a report').setInputFiles({
    name: 'scan.png',
    mimeType: 'image/png',
    buffer: onePixelPng,
  });
  await page.getByLabel('Previous injuries (optional)').fill('Sprained ankle, 2019');
  await next(page);

  // Check and submit reads the answers back; Change goes to the screen.
  await at(page, 'end');
  await expect(page.getByRole('heading', { name: 'Check and submit' })).toBeVisible();
  const problem = page.locator('[data-check="problem"]');
  await expect(problem).toContainText('Right knee, front, Right knee, back');
  await expect(problem).toContainText('6 out of 10');
  await expect(problem).toContainText('Not answered');
  await expect(page.locator('[data-check="health_check"]')).toContainText('Diabetes');
  await expect(page.locator('[data-check="activity"]')).toContainText('Running, Other (specify)');
  await expect(page.locator('[data-check="history"]')).toContainText('1 added');
  await expect(page.locator('[data-check="consent"]')).toContainText('Agreed and signed');
  await page.getByRole('link', { name: 'Change About you' }).click();
  await at(page, 'about_you');
  await expect(page.getByLabel('Occupation')).toHaveValue('Teacher');
  await page.goto(`${path}?screen=end`);
  await page.getByRole('button', { name: 'Submit' }).click();

  await expect(page.getByTestId('patient-link-status')).toHaveText(
    'Thank you. Your answers are with your physiotherapist.',
  );
  test.info().annotations.push({
    type: 'scripted run',
    description: `${String(Math.round((Date.now() - started) / 1000))} s`,
  });
  const done = await submittedOf(visit.id);
  expect(done?.submittedAt).toBeInstanceOf(Date);
  expect(done?.completedAt).toBeInstanceOf(Date);
  expect((await savedForm(visit.id))?.answers).toMatchObject({
    sex: 'female',
    occupation: 'Teacher',
    region: 'knee',
    pain_site: ['right_knee_front', 'right_knee_back'],
    pain_now: 6,
    onset: 'gradual',
    health_conditions: ['diabetes'],
    activities: ['running', 'other'],
    activity_other: 'Frisbee',
    injuries: 'Sprained ankle, 2019',
  });
  const reports = await reportsOf(visit.id);
  expect(reports).toHaveLength(1);
  expect(reports[0]?.uploadedBy).toBeNull();
  expect(typeof reports[0]?.patientLinkId).toBe('string');

  // The desk sees the form submitted and the report added by the patient.
  const desk = await temporaryDesk();
  const deskPage = await phone(page.context().browser() as Browser);
  await signIn(deskPage, desk.email);
  await deskPage.goto(`/app/today?centre=${await centreIdByCode('HSR')}&appointment=${visit.id}`);
  const drawer = deskPage.getByRole('complementary', { name: 'Check in' });
  await expect(drawer).toContainText('Submitted');
  await expect(drawer.getByTestId('report-list')).toContainText('Added by the patient');
  await deskPage.context().close();
});

test('for a male patient there is no pregnancy question', async ({ page }) => {
  const patient = await testPatient();
  const { path } = await visitLink(patient);
  await page.goto(path);
  await page.getByRole('link', { name: 'Start' }).click();
  await signConsent(page);
  await aboutYou(page, 'Male');
  await question(page, 'Body region').getByText('Hip', { exact: true }).click();
  await next(page);
  await noWarningSigns(page);
  await at(page, 'health_check');
  await expect(question(page, 'Tick any that apply').getByText('Osteoporosis')).toBeVisible();
  await expect(page.getByText('Pregnancy / breastfeeding')).toHaveCount(0);
});

test('works without scripts: chart boxes, 0 to 10 buttons, and a submit', async ({ browser }) => {
  const patient = await testPatient();
  const { visit, path } = await visitLink(patient);
  const page = await phone(browser, false);
  await page.goto(path);
  await page.getByRole('link', { name: 'Start' }).click();
  await signConsent(page);
  await aboutYou(page, 'Other');
  await question(page, 'Body region').getByText('Back', { exact: true }).click();
  await page.getByTitle('Lower back').click();
  await question(page, 'Pain with activity (optional)').getByText('7', { exact: true }).click();
  await next(page);
  await noWarningSigns(page);
  await question(page, 'Tick any that apply').getByText('None of these', { exact: true }).click();
  await next(page);
  await at(page, 'activity');
  await activityFollowUp(page);
  await next(page);
  await at(page, 'history');
  await next(page);
  await at(page, 'end');
  await page.getByRole('button', { name: 'Submit' }).click();
  await expect(page.getByTestId('patient-link-status')).toHaveText(
    'Thank you. Your answers are with your physiotherapist.',
  );
  expect((await savedForm(visit.id))?.answers).toMatchObject({
    sex: 'other',
    pain_site: ['lower_back'],
    pain_activity: 7,
    health_conditions: ['none'],
    activities: ['other'],
    activity_other: 'Kho kho',
  });
  expect((await submittedOf(visit.id))?.submittedAt).toBeInstanceOf(Date);
  await page.context().close();
});

/** Other (specify) shows by CSS while Other is ticked. */
async function activityFollowUp(page: Page) {
  const other = page.getByLabel('Other (specify) (optional)');
  await expect(other).toBeHidden();
  await question(page, 'Activity (optional)').getByText('Other (specify)', { exact: true }).click();
  await expect(other).toBeVisible();
  await other.fill('Kho kho');
}
