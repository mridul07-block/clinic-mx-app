import { istDate } from '@clinic-mx/schemas';
import { expect, test, type Browser, type Page } from '@playwright/test';
import { removeCalendarRows, startedAppointment } from './calendar';
import { tabletNamed } from './kiosk';
import { testEpisode, testPatient } from './patients';
import { signIn, temporaryDesk, temporaryWithCode } from './staff';

// INT-02 done when: the check in drawer has the identity check, form status, Show QR, Open on
// tablet and Add reports. Decisions (user, 23 October 2026): Check in opens the drawer, the desk
// ticks that it checked who this is, then checks in; the health form is for a first visit (no
// episode yet); the desk adds reports and sees the list, opening them comes with CLN. Each test has
// its own temporary physio with an appointment that started a few minutes ago today.

const made: string[] = [];
test.afterEach(async () => {
  if (made.length) await removeCalendarRows(made.splice(0));
});

type Patient = Awaited<ReturnType<typeof testPatient>>;

async function visit(given?: Patient, values: { episodeId?: string } = {}) {
  const person = await temporaryWithCode('physiotherapist', ['HSR Layout']);
  made.push(person.id);
  const patient = given ?? (await testPatient());
  const started = await startedAppointment(person.id, patient.id, 3, { minutes: 5, values });
  test.skip(istDate(started.startsAt) !== istDate(new Date()), 'Just after midnight in IST.');
  return { patient, number: started.number };
}

const drawer = (page: Page) => page.getByRole('complementary', { name: 'Check in' });

async function openDrawer(page: Page, patientName: string) {
  await page
    .getByTestId('today-row')
    .filter({ hasText: patientName })
    .getByRole('link', { name: `Check in ${patientName}` })
    .click();
  await expect(drawer(page)).toBeVisible();
}

async function checkIn(page: Page) {
  await drawer(page).getByLabel('I have checked who this is (name and date of birth)').check();
  await drawer(page).getByRole('button', { name: 'Check in', exact: true }).click();
  await expect(drawer(page).getByTestId('checked-in')).toContainText('Checked in');
}

/** Another browser like this project's: the patient's phone, or the clinic tablet. */
async function anotherBrowser(browser: Browser): Promise<Page> {
  const { viewport, isMobile, hasTouch, userAgent, deviceScaleFactor, baseURL } =
    test.info().project.use;
  const context = await browser.newContext({
    viewport,
    isMobile,
    hasTouch,
    userAgent,
    deviceScaleFactor,
    baseURL,
  });
  return context.newPage();
}

test('Check in opens the drawer; the identity tick comes first; undo puts it back', async ({
  page,
}) => {
  const { patient, number } = await visit();
  const desk = await temporaryDesk();
  await signIn(page, desk.email);
  await openDrawer(page, patient.name);

  await expect(drawer(page)).toContainText(number);
  await expect(drawer(page).getByTestId('identity')).toContainText(
    `Ending ${patient.phone.slice(-4)}`,
  );
  await expect(drawer(page).getByTestId('identity')).toContainText('Date of birth not recorded');
  await drawer(page).getByRole('button', { name: 'Check in', exact: true }).click();
  await expect(drawer(page)).toContainText('Tick that you have checked who this is.');

  await checkIn(page);
  await expect(drawer(page).getByTestId('checked-in')).toContainText(`by ${desk.name}`);
  await expect(page.getByTestId('check-in-done')).toHaveText('Checked in.');
  await expect(page.getByTestId('today-row').filter({ hasText: patient.name })).toContainText(
    /Here \d+ min/,
  );

  await drawer(page).getByRole('button', { name: 'Undo check in' }).click();
  await expect(page.getByTestId('check-in-done')).toHaveText('Check in undone.');
  await expect(
    drawer(page).getByLabel('I have checked who this is (name and date of birth)'),
  ).toBeVisible();
});

test('a first visit shows the health form QR, which opens the form', async ({ page, browser }) => {
  const { patient } = await visit();
  const desk = await temporaryDesk();
  await signIn(page, desk.email);
  await openDrawer(page, patient.name);
  await checkIn(page);
  await expect(drawer(page).getByTestId('form-status')).toHaveText('Not sent');

  await drawer(page).getByRole('button', { name: 'Show QR' }).click();
  const qr = drawer(page).getByTestId('form-qr');
  await expect(
    qr.getByRole('img', { name: 'QR code for the patient’s health form' }),
  ).toBeVisible();
  await expect(qr).toContainText('Scan with your phone camera. Works until');
  await expect(drawer(page).getByTestId('form-status')).toHaveText('Waiting for the patient');
  const path = (await qr.locator('.font-mono').innerText()).trim();
  expect(path).toMatch(/^\/p\/\S+$/);

  const phone = await anotherBrowser(browser);
  await phone.goto(path);
  await expect(phone.getByRole('heading', { name: 'Your health form' })).toBeVisible();
  await phone.context().close();
});

test('Open on tablet sends the form to the centre’s kiosk tablet', async ({ page, browser }) => {
  const { patient } = await visit();
  const tablet = await anotherBrowser(browser);
  const setter = await temporaryDesk();
  const name = `Tablet ${crypto.randomUUID().slice(0, 8)}`;
  await signIn(tablet, setter.email);
  await tablet.goto('/app/kiosk-tablets');
  await tablet.getByLabel('Tablet name').fill(name);
  await tablet.getByRole('button', { name: 'Set up as kiosk and sign out' }).click();
  await expect(tablet).toHaveURL(/\/kiosk$/);
  const kioskId = await tabletNamed(name);

  const desk = await temporaryDesk();
  await signIn(page, desk.email);
  await openDrawer(page, patient.name);
  await checkIn(page);
  const picker = drawer(page).getByLabel('Tablet');
  if (await picker.count()) await picker.selectOption(kioskId);
  await drawer(page)
    .getByRole('button', { name: (await picker.count()) ? 'Open on tablet' : `Open on ${name}` })
    .click();
  await expect(page.getByTestId('check-in-done')).toHaveText(
    'Sent to the tablet. It opens the form within a few seconds.',
  );
  await expect(tablet).toHaveURL(/\/p\//, { timeout: 15_000 });
  await expect(tablet.getByRole('heading', { name: 'Your health form' })).toBeVisible();
  await tablet.context().close();
});

// A 1 by 1 PNG, and the start of a PDF: real enough for the type checks; the photo is redrawn
// as a JPEG on the device before it is sent.
const onePixelPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
const smallPdf = Buffer.from('%PDF-1.4\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n');

test('the desk adds report photos and PDFs and sees the list; other files are refused', async ({
  page,
}) => {
  const { patient } = await visit();
  const desk = await temporaryDesk();
  await signIn(page, desk.email);
  await openDrawer(page, patient.name);
  const files = drawer(page).getByLabel(/Photos or PDFs of the patient’s reports/);

  await files.setInputFiles([
    { name: 'knee-scan.png', mimeType: 'image/png', buffer: onePixelPng },
    { name: 'mri-report.pdf', mimeType: 'application/pdf', buffer: smallPdf },
  ]);
  await drawer(page).getByRole('button', { name: 'Add reports' }).click();
  await expect(page.getByTestId('check-in-done')).toHaveText('Reports added.');
  const list = drawer(page).getByTestId('report-list');
  await expect(list.getByRole('listitem')).toHaveCount(2);
  await expect(list).toContainText('Photo');
  await expect(list).toContainText('PDF');
  await expect(list).toContainText(`Added by ${desk.name}`);

  await files.setInputFiles([
    { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('not a report') },
  ]);
  await drawer(page).getByRole('button', { name: 'Add reports' }).click();
  await expect(drawer(page)).toContainText('notes.txt is not a photo or PDF.');
  await files.setInputFiles([
    {
      name: 'huge.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.concat([smallPdf, Buffer.alloc(4 * 1024 * 1024)]),
    },
  ]);
  await drawer(page).getByRole('button', { name: 'Add reports' }).click();
  await expect(drawer(page)).toContainText('huge.pdf is larger than 4 MB.');
  await expect(list.getByRole('listitem')).toHaveCount(2);
});

test('a visit in an open episode has no health form', async ({ page }) => {
  const patient = await testPatient();
  const episodeId = await testEpisode(patient.id, 'active');
  await visit(patient, { episodeId });
  const desk = await temporaryDesk();
  await signIn(page, desk.email);
  await openDrawer(page, patient.name);
  await checkIn(page);
  await expect(drawer(page).getByTestId('no-health-form')).toHaveText(
    'No health form for this visit: it is part of an open episode.',
  );
  await expect(drawer(page).getByRole('button', { name: 'Show QR' })).toHaveCount(0);
});
