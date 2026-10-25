import { expect, test, type Page } from '@playwright/test';
import { centreIdByCode, removeCalendarRows, startedAppointment } from './calendar';
import { otherBrowser } from './intake';
import { testPatient } from './patients';
import { signIn, signInWithCode, temporaryDesk, temporaryWithCode } from './staff';

// ALT-08 done when: report photos are resized on the phone, kept in private storage and visible
// to clinicians only. Decisions (user, 23 October 2026): clinicians open them from "Reports" on
// the patient record; any clinician (clinical.read), whatever the centre. The desk adds a large
// photo at check in; a physio at another centre opens it, shrunk; the desk cannot.

const made: string[] = [];
test.afterEach(async () => {
  if (made.length) await removeCalendarRows(made.splice(0));
});

/** A 3000 by 2000 PNG drawn in the browser: larger than the phone keeps. */
const bigPhoto = (page: Page) =>
  page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 3000;
    canvas.height = 2000;
    // Filled in the default colour, so the photo is not empty.
    canvas.getContext('2d')?.fillRect(0, 0, 3000, 2000);
    return canvas.toDataURL('image/png').split(',')[1] ?? '';
  });

test('the desk adds a photo, shrunk on the device; only a clinician opens it', async ({
  page,
  browser,
}) => {
  const physio = await temporaryWithCode('physiotherapist', ['HSR Layout']);
  made.push(physio.id);
  const patient = await testPatient();
  const visit = await startedAppointment(physio.id, patient.id, 3, { minutes: 5 });

  // The desk adds it at check in.
  const desk = await temporaryDesk();
  await signIn(page, desk.email);
  await page.goto(`/app/today?centre=${await centreIdByCode('HSR')}&appointment=${visit.id}`);
  const drawer = page.getByRole('complementary', { name: 'Check in' });
  await drawer.getByLabel(/Photos or PDFs of the patient’s reports/).setInputFiles([
    {
      name: 'knee.png',
      mimeType: 'image/png',
      buffer: Buffer.from(await bigPhoto(page), 'base64'),
    },
  ]);
  await drawer.getByRole('button', { name: 'Add reports' }).click();
  await expect(page.getByTestId('check-in-done')).toHaveText('Reports added.');
  await expect(drawer.getByTestId('report-list')).toContainText('Photo');
  await expect(drawer).toContainText('Only clinicians open reports, from the patient record.');

  // A physio at another centre opens it from the patient record: a JPEG, 1600 px at most.
  const elsewhere = await temporaryWithCode('physiotherapist', ['Koramangala']);
  made.push(elsewhere.id);
  const clinician = await otherBrowser(browser);
  await signInWithCode(clinician, elsewhere.email, elsewhere.secret);
  await clinician.goto(`/app/patients/${patient.id}?tab=documents`);
  const reports = clinician.getByTestId('patient-reports');
  await expect(reports.getByTestId('patient-report')).toHaveCount(1);
  await expect(reports).toContainText('Photo · staff');
  const photo = reports.getByRole('img');
  await expect.poll(() => photo.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(1600);
  expect(await photo.evaluate((img: HTMLImageElement) => img.naturalHeight)).toBe(1067);
  const href = (await photo.getAttribute('src')) ?? '';
  expect(href).toMatch(/^\/app\/reports\/[0-9a-f-]{36}$/);
  const opened = await clinician.request.get(href);
  expect(opened.status()).toBe(200);
  expect(opened.headers()['content-type']).toBe('image/jpeg');
  expect(opened.headers()['cache-control']).toBe('private, no-store');
  await clinician.context().close();

  // The desk sees no Reports on the record, and the file is not found for it.
  await page.goto(`/app/patients/${patient.id}?tab=documents`);
  await expect(page.getByRole('heading', { name: patient.name })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Reports' })).toHaveCount(0);
  expect((await page.request.get(href)).status()).toBe(404);
  await page.context().clearCookies();
  // Signed out, the proxy sends it to sign in before the route is reached.
  const signedOut = await page.request.get(href, { maxRedirects: 0 });
  expect(signedOut.status()).toBe(307);
  expect(signedOut.headers().location).toContain('/app/sign-in');
});
