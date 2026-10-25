import { istDate } from '@clinic-mx/schemas';
import { expect, test } from '@playwright/test';
import { completeVisit, consultantFee } from './bills';
import { centreIdByCode, removeCalendarRows, startedAppointment } from './calendar';
import { signedConsultation } from './consultations';
import { removePipelineRows } from './intake';
import { tickUntil } from './jobs';
import { consultationTypeId, submittedWithAlert } from './my-patients';
import { testPatient } from './patients';
import { proposedPlan } from './plan-sheet';
import { signIn, temporaryDesk, temporaryWithCode } from './staff';

// BIL-09 done when: a numbered PDF; the receipt sent on WhatsApp (queued until WhatsApp exists).
// Decisions (user, 25 October 2026): the centre's own invoice series (HSR-INV-00001); undoing the
// payment makes a version marked cancelled; a package's expiry from the payment date.

const physios: string[] = [];
const visits: string[] = [];
test.afterEach(async () => {
  await removePipelineRows(visits.splice(0));
  if (physios.length) await removeCalendarRows(physios.splice(0));
});

test('paying makes a numbered invoice PDF, and undoing the payment makes its cancelled version', async ({
  page,
  browser,
}) => {
  const physio = await temporaryWithCode('physiotherapist', ['HSR Layout'], { consultant: true });
  physios.push(physio.id);
  await consultantFee(physio.id, 'consultation');
  const patient = await testPatient();
  const visit = await startedAppointment(physio.id, patient.id, 50, {
    minutes: 45,
    values: {
      appointmentTypeId: await consultationTypeId(),
      status: 'checked_in',
      arrivedAt: new Date(),
      checkedInBy: physio.id,
    },
  });
  visits.push(visit.id);
  test.skip(
    istDate(visit.startsAt) !== istDate(new Date()),
    'The visit falls on yesterday in IST.',
  );
  await submittedWithAlert(visit.id, patient.id);
  const { consultationId } = await signedConsultation(visit.id, physio.id);
  await completeVisit(visit.id);
  await proposedPlan(consultationId);

  const desk = await temporaryDesk();
  await signIn(page, desk.email);
  await page.goto(`/app/today?centre=${await centreIdByCode('HSR')}`);
  await page.getByRole('link', { name: `Plan and payment for ${patient.name}` }).click();
  await expect(page.getByRole('heading', { name: 'Plan and payment' })).toBeVisible();
  const href = new URL(page.url()).pathname;

  // Paid: the invoice is numbered at once and made by the next tick of the queue.
  const fee = page.getByTestId('bill').filter({ hasText: 'Consultation fee' });
  await fee.getByRole('radio', { name: 'UPI QR' }).check();
  await fee.getByLabel('Reference (optional)').fill('UPI-INV-1');
  await fee.getByRole('button', { name: 'Mark paid ₹750' }).click();
  await expect(fee.getByTestId('invoice-pending')).toContainText(/Invoice HSR-INV-\d{5} is being/);
  const link = fee.getByTestId('invoice-link');
  await tickUntil(page.request, async () => {
    await page.reload();
    await expect(link).toHaveText(/^Invoice HSR-INV-\d{5} \(PDF\)$/, { timeout: 1_000 });
  });
  const invoiceHref = await link.getAttribute('href');
  const pdf = await page.request.get(invoiceHref ?? '');
  expect(pdf.status()).toBe(200);
  expect(pdf.headers()['content-type']).toBe('application/pdf');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: test.info().outputPath('invoice-link.png'), fullPage: true });

  await page.goto(`/app/patients/${patient.id}`);
  const listed = page.getByTestId('patient-document').filter({ hasText: 'Invoice and receipt' });
  await expect(listed).toContainText('Version 1');

  // Undone: the next tick makes version 2, printed as cancelled.
  await page.goto(href);
  await fee.locator('summary', { hasText: 'Undo payment' }).click();
  await fee.getByLabel('Why is it undone?').fill('Recorded against the wrong bill');
  await fee.getByRole('button', { name: 'Undo payment' }).click();
  await expect(fee.getByRole('button', { name: 'Mark paid ₹750' })).toBeVisible();
  await tickUntil(page.request, async () => {
    await page.goto(`/app/patients/${patient.id}`);
    await expect(listed).toContainText('Version 2', { timeout: 1_000 });
  });
  await expect(listed).toContainText('Earlier versions');

  // The desk at another centre cannot open it.
  const elsewhere = await browser.newContext(test.info().project.use);
  const desk2 = await elsewhere.newPage();
  await signIn(desk2, 'desk.koramangala@clinicmx.test');
  const refused = await desk2.request.get(invoiceHref ?? '');
  expect(refused.status()).not.toBe(200);
  await elsewhere.close();
});
