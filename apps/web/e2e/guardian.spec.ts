import { expect, test, type Browser, type Page } from '@playwright/test';
import { removeCalendarRows, startedAppointment } from './calendar';
import { ageQuestion, consentCard, consentOf, drawSignature } from './intake';
import { testLink } from './patient-links';
import { bornYearsAgo, testGuardian, testPatient } from './patients';
import { temporaryWithCode } from './staff';

// INT-07 done when: under 18 opens the guardian section; the guardian signs. Decisions (user, 23
// October 2026): a guardian on file chosen under "Who is signing?" signs Part A, and the records
// name them; with no guardian on file, "Please speak to reception."; without a date of birth on
// file the consent screen asks "Is the patient under 18?". Each test has its own temporary physio
// and a generated patient's visit, checked in a few minutes ago today.

const made: string[] = [];
test.afterEach(async () => {
  if (made.length) await removeCalendarRows(made.splice(0));
});

async function visitLink(patient: { id: string }) {
  const physio = await temporaryWithCode('physiotherapist', ['HSR Layout']);
  made.push(physio.id);
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

const section = (page: Page) => page.getByTestId('guardian-section');
const signer = (page: Page) => page.getByRole('group', { name: 'Who is signing?' });
const agreeToBoth = async (page: Page) => {
  for (const text of [
    'I consent to the pre-consultation screening',
    'I consent to the collection and storage of my mobile number',
  ]) {
    await consentCard(page, text).getByText('I agree', { exact: true }).click();
  }
};
const next = (page: Page) => page.getByRole('button', { name: 'Next' }).click();

test('a guardian on file signs for a patient under 18', async ({ page }) => {
  const patient = await testPatient({ dateOfBirth: bornYearsAgo(12) });
  const guardian = await testGuardian(patient.id, 'mother');
  const { visit, path } = await visitLink(patient);
  await page.goto(path);
  await page.getByRole('link', { name: 'Start' }).click();
  await expect(ageQuestion(page)).toHaveCount(0);
  await expect(section(page)).toContainText('A parent or guardian signs for a patient under 18.');
  await expect(signer(page).getByRole('radio', { name: `${guardian}, Mother` })).toBeVisible();

  await agreeToBoth(page);
  await drawSignature(page);
  await next(page);
  await expect(signer(page)).toContainText('Choose who is signing.');
  await signer(page).getByText(`${guardian}, Mother`).click();
  await drawSignature(page);
  await next(page);
  await expect(page).toHaveURL(/\?screen=about_you$/);
  const records = await consentOf(visit.id);
  expect(records.map((r) => [r.statementKey, r.accepted, r.signer])).toEqual([
    ['part_a.contact', true, 'guardian'],
    ['part_a.screening', true, 'guardian'],
  ]);
  expect(new Set(records.map((r) => r.guardianId)).size).toBe(1);
  expect(records[0]?.guardianId).toEqual(expect.any(String));
});

test('without a date of birth the form asks; under 18 with no guardian on file waits for reception', async ({
  page,
}) => {
  const patient = await testPatient();
  const { visit, path } = await visitLink(patient);
  await page.goto(path);
  await page.getByRole('link', { name: 'Start' }).click();
  await expect(ageQuestion(page)).toBeVisible();
  await expect(section(page)).toBeHidden();
  await next(page);
  await expect(ageQuestion(page)).toContainText('Answer this question.');

  await ageQuestion(page).getByText('Yes', { exact: true }).click();
  await expect(section(page)).toBeVisible();
  await expect(page.getByTestId('guardian-missing')).toHaveText('Please speak to reception.');
  await agreeToBoth(page);
  await drawSignature(page);
  await next(page);
  await expect(page.getByTestId('consent-declined')).toHaveText('Please speak to reception.');
  expect(await consentOf(visit.id)).toEqual([]);

  // Not under 18 after all: the patient signs.
  await page.getByRole('link', { name: 'Change my answer' }).click();
  await ageQuestion(page).getByText('No', { exact: true }).click();
  await expect(section(page)).toBeHidden();
  await agreeToBoth(page);
  await drawSignature(page);
  await next(page);
  await expect(page).toHaveURL(/\?screen=about_you$/);
  expect((await consentOf(visit.id)).map((r) => [r.signer, r.guardianId])).toEqual([
    ['patient', null],
    ['patient', null],
  ]);
});

test('works without scripts: the age question opens the guardian section by CSS', async ({
  browser,
}) => {
  const patient = await testPatient();
  const guardian = await testGuardian(patient.id, 'father');
  const { visit, path } = await visitLink(patient);
  const page = await phone(browser, false);
  await page.goto(path);
  await page.getByRole('link', { name: 'Start' }).click();
  await expect(section(page)).toBeHidden();
  await ageQuestion(page).getByText('Yes', { exact: true }).click();
  await expect(section(page)).toBeVisible();
  await signer(page).getByText(`${guardian}, Father`).click();
  await agreeToBoth(page);
  await page.getByLabel('Type your full name to sign').fill(guardian);
  await next(page);
  await expect(page).toHaveURL(/\?screen=about_you$/);
  expect((await consentOf(visit.id)).map((r) => [r.signer, r.typedName])).toEqual([
    ['guardian', guardian],
    ['guardian', guardian],
  ]);
  await page.context().close();
});
