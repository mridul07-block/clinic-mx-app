import { expect, test, type Browser, type Page } from '@playwright/test';
import { removeCalendarRows, startedAppointment } from './calendar';
import { aboutYou, savedForm, signConsent, undoCheckInOf } from './intake';
import { testLink } from './patient-links';
import { testPatient } from './patients';
import { temporaryWithCode } from './staff';

// INT-04 done when: a versioned form, conditional screens, and resume after leaving. Decision
// (user, 23 October 2026): the region ("Your problem") and the warning signs, with back and neck
// questions for that region and the weight loss follow ups after a yes. New forms (hf-3, INT-05)
// open on Part A consent, signed first, then About you; the other screens and the submit are in
// health-form-screens.spec.ts. Each test has its own temporary physio and a generated patient's
// visit, checked in a few minutes ago today, and its health form link.

const made: string[] = [];
test.afterEach(async () => {
  if (made.length) await removeCalendarRows(made.splice(0));
});

async function visitLink() {
  const physio = await temporaryWithCode('physiotherapist', ['HSR Layout']);
  made.push(physio.id);
  const patient = await testPatient();
  const visit = await startedAppointment(physio.id, patient.id, 3, {
    minutes: 5,
    values: { status: 'checked_in', arrivedAt: new Date(), checkedInBy: physio.id },
  });
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

const step = (page: Page) => page.getByTestId('health-form-step');
const question = (page: Page, text: string) => page.getByRole('group', { name: text });
/** Picks an answer by its label: radios are drawn as buttons. */
const pick = (page: Page, text: string, answer: string) =>
  question(page, text).getByText(answer, { exact: true }).click();
const next = (page: Page) => page.getByRole('button', { name: 'Next' }).click();
const missing = (page: Page) =>
  page.getByRole('alert').filter({ hasText: 'Please answer the questions marked below.' });

const weightLoss = 'Have you had unexplained weight loss recently?';
const backBowel = 'Any loss of control of your bowels?';
const neckVision = 'Do you have double vision?';
const kilograms = 'About how many kilograms have you lost?';

/** Answers No to every question on the screen, and 0 to the number ones. */
async function answerAll(page: Page) {
  for (const group of await page.getByRole('group').all()) {
    const no = group.getByText('No', { exact: true });
    if ((await no.count()) > 0 && (await no.isVisible())) await no.click();
  }
  await page.getByLabel(/how many minutes does it last/).fill('0');
}

test('the form opens screen by screen; shown answers are needed; questions follow the region', async ({
  page,
}) => {
  const { path } = await visitLink();
  await page.goto(path);
  await page.getByRole('link', { name: 'Start' }).click();
  await signConsent(page);
  await aboutYou(page);
  await expect(step(page)).toHaveText('Step 3 of 7');
  await expect(page.getByRole('heading', { name: 'Your problem' })).toBeVisible();
  await next(page);
  await expect(missing(page)).toBeVisible();
  await expect(question(page, 'Body region')).toContainText('Answer this question.');

  await question(page, 'Body region').getByText('Back', { exact: true }).click();
  await next(page);
  await expect(page).toHaveURL(/\?screen=warning_signs$/);
  await expect(step(page)).toHaveText('Step 4 of 7');
  await expect(question(page, backBowel)).toBeVisible();
  await expect(question(page, neckVision)).toHaveCount(0);

  // The weight loss follow ups show after a yes.
  await expect(page.getByLabel(kilograms)).toBeHidden();
  await pick(page, weightLoss, 'Yes');
  await expect(page.getByLabel(kilograms)).toBeVisible();
  await next(page);
  await expect(missing(page)).toBeVisible();
  await expect(question(page, backBowel)).toContainText('Answer this question.');
  // What was ticked stays ticked.
  await expect(page.getByLabel(kilograms)).toBeVisible();
});

test('leaving and coming back carries on where it stopped, and a new region changes the questions', async ({
  page,
  browser,
}) => {
  const { visit, path } = await visitLink();
  const first = await phone(browser);
  await first.goto(path);
  await first.getByRole('link', { name: 'Start' }).click();
  await signConsent(first);
  await aboutYou(first);
  await question(first, 'Body region').getByText('Back', { exact: true }).click();
  await next(first);
  await expect(first).toHaveURL(/\?screen=warning_signs$/);
  await first.context().close();

  await page.goto(path);
  await page.getByRole('link', { name: 'Continue' }).click();
  await expect(page).toHaveURL(/\?screen=warning_signs$/);
  await expect(question(page, backBowel)).toBeVisible();
  await page.getByRole('link', { name: 'Back' }).click();
  await expect(question(page, 'Body region').getByRole('radio', { name: 'Back' })).toBeChecked();
  await question(page, 'Body region').getByText('Knee', { exact: true }).click();
  await next(page);
  await expect(page).toHaveURL(/\?screen=warning_signs$/);
  await expect(question(page, backBowel)).toHaveCount(0);
  expect((await savedForm(visit.id))?.answers).toEqual({ sex: 'female', region: 'knee' });
});

test('all answered: saved on its version, by the patient', async ({ page }) => {
  const { visit, path } = await visitLink();
  await page.goto(`${path}?screen=warning_signs`);
  // Not reached yet: it opens where the form stands, Part A consent first.
  await expect(page).toHaveURL(/\?screen=consent$/);
  await signConsent(page);
  await aboutYou(page);
  await question(page, 'Body region').getByText('Neck', { exact: true }).click();
  await next(page);
  await expect(question(page, neckVision)).toBeVisible();
  await answerAll(page);
  await next(page);
  await expect(page).toHaveURL(/\?screen=health_check$/);
  const saved = await savedForm(visit.id);
  expect(saved).toMatchObject({
    formVersion: 'hf-3',
    doneScreens: ['consent', 'about_you', 'problem', 'warning_signs'],
  });
  expect(saved?.answers).toMatchObject({
    region: 'neck',
    neck_double_vision: false,
    morning_stiffness_minutes: 0,
  });
  expect(saved?.actors).toEqual([expect.stringMatching(/^patient:/)]);
  await page.goto(path);
  await expect(page.getByRole('link', { name: 'Continue' })).toBeVisible();
});

test('a visit no longer on saves nothing more', async ({ page }) => {
  const { visit, path } = await visitLink();
  await page.goto(path);
  await page.getByRole('link', { name: 'Start' }).click();
  await signConsent(page);
  await aboutYou(page);
  await question(page, 'Body region').getByText('Hip', { exact: true }).click();
  await next(page);
  await expect(page).toHaveURL(/\?screen=warning_signs$/);
  await undoCheckInOf(visit.id);
  await answerAll(page);
  await next(page);
  await expect(page.getByTestId('patient-link-status')).toHaveText(
    'This form is no longer open. Please ask the front desk.',
  );
  expect((await savedForm(visit.id))?.doneScreens).toEqual(['consent', 'about_you', 'problem']);
});

test('works without scripts: follow ups show by CSS, messages by the server', async ({
  browser,
}) => {
  const { path } = await visitLink();
  const page = await phone(browser, false);
  await page.goto(path);
  await page.getByRole('link', { name: 'Start' }).click();
  await signConsent(page);
  await aboutYou(page);
  await question(page, 'Body region').getByText('Wrist and hand', { exact: true }).click();
  await next(page);
  await expect(page).toHaveURL(/\?screen=warning_signs$/);
  await expect(page.getByLabel(kilograms)).toBeHidden();
  await pick(page, weightLoss, 'Yes');
  await expect(page.getByLabel(kilograms)).toBeVisible();
  await next(page);
  await expect(missing(page)).toBeVisible();
  await page.context().close();
});
