import { istDate } from '@clinic-mx/schemas';
import { expect, test, type Browser, type Page } from '@playwright/test';
import { centreIdByCode, removeCalendarRows, startedAppointment } from './calendar';
import { consentCard, consentOf, drawSignature, notUnderAge, signatureStored } from './intake';
import { testLink } from './patient-links';
import { testPatient } from './patients';
import { signIn, temporaryDesk, temporaryWithCode } from './staff';

// INT-06 done when: two Part A statements recorded with version, time and signature; a decline
// blocks with "Please speak to reception". Decisions (user, 23 October 2026): signed on a pad, or
// with a typed full name without scripts; a decline is recorded, reception sees "Consent
// declined", and the patient may change their mind; consent is the form's first screen. Each
// test has its own temporary physio and a generated patient's visit, checked in a few minutes ago.

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
  test.skip(istDate(visit.startsAt) !== istDate(new Date()), 'Just after midnight in IST.');
  const link = await testLink({
    purpose: 'health_form',
    patientId: patient.id,
    appointmentId: visit.id,
  });
  return { patient, visit, path: link.path };
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

const screening = 'I consent to the pre-consultation screening';
const contact = 'I consent to the collection and storage of my mobile number';
const choose = (page: Page, card: string, answer: 'I agree' | 'I do not agree') =>
  consentCard(page, card).getByText(answer, { exact: true }).click();
const next = (page: Page) => page.getByRole('button', { name: 'Next' }).click();

test('a decline blocks the form for reception; changing their mind and signing opens the questions', async ({
  page,
  browser,
}) => {
  const { patient, visit, path } = await visitLink();
  const patientPhone = await phone(browser);
  await patientPhone.goto(path);
  await patientPhone.getByRole('link', { name: 'Start' }).click();
  await expect(patientPhone).toHaveURL(/\?screen=consent$/);
  await expect(
    patientPhone.getByRole('heading', { name: 'Pre-consultation consent' }),
  ).toBeVisible();
  await expect(consentCard(patientPhone, screening)).toContainText('Version 1');
  await next(patientPhone);
  await expect(consentCard(patientPhone, contact)).toContainText(
    'Choose I agree or I do not agree.',
  );

  await notUnderAge(patientPhone);
  await choose(patientPhone, screening, 'I agree');
  await choose(patientPhone, contact, 'I do not agree');
  await next(patientPhone);
  await expect(patientPhone.getByTestId('consent-declined')).toHaveText(
    'Please speak to reception.',
  );
  expect(await consentOf(visit.id)).toEqual([
    {
      statementKey: 'part_a.contact',
      accepted: false,
      signatureKind: null,
      signatureFile: null,
      typedName: null,
      signer: 'patient',
      guardianId: null,
    },
  ]);

  // Reception sees it on Today and in the check in drawer.
  const desk = await temporaryDesk();
  await signIn(page, desk.email);
  await page.goto(`/app/today?centre=${await centreIdByCode('HSR')}&appointment=${visit.id}`);
  await expect(page.getByTestId('today-row').filter({ hasText: patient.name })).toContainText(
    'Consent declined',
  );
  await expect(
    page.getByRole('complementary', { name: 'Check in' }).getByTestId('form-status'),
  ).toHaveText('Consent declined');

  // They change their mind: both agreed, signed on the pad.
  await patientPhone.getByRole('link', { name: 'Change my answer' }).click();
  await notUnderAge(patientPhone);
  await choose(patientPhone, screening, 'I agree');
  await choose(patientPhone, contact, 'I agree');
  await drawSignature(patientPhone);
  await next(patientPhone);
  await expect(patientPhone).toHaveURL(/\?screen=problem$/);
  const records = await consentOf(visit.id);
  expect(records.map((r) => [r.statementKey, r.accepted, r.signatureKind])).toEqual([
    ['part_a.contact', false, null],
    ['part_a.contact', true, 'drawn'],
    ['part_a.screening', true, 'drawn'],
  ]);
  const file = records[1]?.signatureFile ?? '';
  expect(file.startsWith(`${patient.id}/`)).toBe(true);
  expect(await signatureStored(file)).toBe(true);
  await page.reload();
  await expect(
    page.getByRole('complementary', { name: 'Check in' }).getByTestId('form-status'),
  ).toHaveText('Waiting for the patient');
  await patientPhone.context().close();
});

test('agreeing needs a signature in the box', async ({ page }) => {
  const { path } = await visitLink();
  await page.goto(`${path}?screen=consent`);
  await notUnderAge(page);
  await choose(page, screening, 'I agree');
  await choose(page, contact, 'I agree');
  await next(page);
  await expect(page.getByText('Please sign in the box.')).toBeVisible();
  await expect(page).toHaveURL(/\?screen=consent$/);
});

test('without scripts the patient signs with their typed full name', async ({ browser }) => {
  const { visit, path } = await visitLink();
  const page = await phone(browser, false);
  await page.goto(path);
  await page.getByRole('link', { name: 'Start' }).click();
  await notUnderAge(page);
  await choose(page, screening, 'I agree');
  await choose(page, contact, 'I agree');
  await next(page);
  await expect(page.getByText('Type your full name to sign.')).toBeVisible();
  await page.getByLabel('Type your full name to sign').fill('Test Patient Typed');
  await next(page);
  await expect(page).toHaveURL(/\?screen=problem$/);
  expect(
    (await consentOf(visit.id)).map((r) => [r.statementKey, r.signatureKind, r.typedName]),
  ).toEqual([
    ['part_a.contact', 'typed', 'Test Patient Typed'],
    ['part_a.screening', 'typed', 'Test Patient Typed'],
  ]);
  await page.context().close();
});
