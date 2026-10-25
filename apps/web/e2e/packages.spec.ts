import { addDays, formatIstDate, istDate, packageValidUntil } from '@clinic-mx/schemas';
import { expect, test } from '@playwright/test';
import { completeVisit, consultantFee } from './bills';
import { centreIdByCode, removeCalendarRows, startedAppointment } from './calendar';
import { signedConsultation } from './consultations';
import { removePipelineRows } from './intake';
import { consultationTypeId, submittedWithAlert } from './my-patients';
import { testPatient } from './patients';
import { packageValidUntil as moveValidUntil, proposedPlan, testPackage } from './plan-sheet';
import { restorePrices, snapshotPrices } from './prices';
import { exclusively, signIn, signInWithCode, temporaryDesk, temporaryWithCode } from './staff';

// BIL-08 done when: paying activates the package (sessions, 3 month expiry, reschedules); the
// meter shows on the sheet and the patient record (physios without prices); Finance's list shows
// active, expiring and expired with sessions left. Decisions (user, 25 October 2026): expired
// packages keep their sessions left; reschedules round down; the undo cancels the package.

const physios: string[] = [];
const visits: string[] = [];
test.afterEach(async () => {
  await removePipelineRows(visits.splice(0));
  if (physios.length) await removeCalendarRows(physios.splice(0));
});

test('paying for the package activates it, with its meter, Finance’s lists and the undo', async ({
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
  await submittedWithAlert(visit.id, patient.id);
  const { consultationId } = await signedConsultation(visit.id, physio.id);
  await completeVisit(visit.id);
  await proposedPlan(consultationId);

  const desk = await temporaryDesk();
  const today = istDate(new Date());
  const validUntil = formatIstDate(packageValidUntil(new Date(), 3));
  await exclusively('e2e prices', async () => {
    const snapshot = await snapshotPrices();
    try {
      await testPackage({
        name: 'E2E Twelve sessions',
        sessions: 12,
        pricePaise: 10_000_00,
        itemKey: 'rehabilitation_session',
      });
      await signIn(page, desk.email);
      await page.goto(`/app/today?centre=${await centreIdByCode('HSR')}`);
      await page.getByRole('link', { name: `Plan and payment for ${patient.name}` }).click();
      await expect(page.getByRole('heading', { name: 'Plan and payment' })).toBeVisible();
      const href = new URL(page.url()).pathname;

      // Chosen and paid: the package is active, 3 months from today, 1 reschedule (12 / 10).
      const form = page.getByTestId('plan-choice-form');
      await form.getByRole('radio', { name: /Package: E2E Twelve sessions/ }).check();
      await form.getByRole('button', { name: 'Record choice' }).click();
      const offer = page.getByTestId('bill').filter({ hasText: 'E2E Twelve sessions' });
      await offer.getByRole('radio', { name: 'UPI QR' }).check();
      await offer.getByRole('button', { name: 'Mark paid ₹10,000' }).click();
      await expect(offer.getByTestId('paid')).toContainText('Paid by UPI QR');
      const meter = page.getByTestId('package-meter');
      await expect(meter).toContainText('E2E Twelve sessions');
      await expect(meter).toContainText('Active');
      await expect(meter.getByTestId('package-meter-text')).toHaveText(
        `0 of 12 used · Valid until ${validUntil} · 1 reschedule left`,
      );
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true);
      await page.screenshot({ path: test.info().outputPath('package-sheet.png'), fullPage: true });

      // The patient record lists it.
      await page.goto(`/app/patients/${patient.id}`);
      await expect(page.getByTestId('patient-packages').getByTestId('package-meter')).toContainText(
        '0 of 12 used',
      );

      // Finance's lists: active; expiring once near its last day; expired with sessions left.
      const rowOf = () => page.getByTestId('package-row').filter({ hasText: patient.name });
      await page.goto('/app/packages');
      await expect(page.getByRole('link', { name: 'Active' })).toHaveAttribute(
        'aria-current',
        'page',
      );
      await expect(rowOf()).toContainText('E2E Twelve sessions');
      await page.getByRole('link', { name: 'Expiring in 14 days' }).click();
      await expect(rowOf()).toHaveCount(0);
      await moveValidUntil(patient.id, addDays(today, 5));
      await page.reload();
      await expect(rowOf()).toContainText('Expiring');
      await page.screenshot({ path: test.info().outputPath('packages-list.png'), fullPage: true });
      await moveValidUntil(patient.id, addDays(today, -1));
      await page.getByRole('link', { name: 'Expired with sessions left' }).click();
      await expect(rowOf()).toContainText('12 sessions left');
      await expect(rowOf()).toContainText('Expired');

      // The desk at another centre sees none of it.
      const elsewhere = await browser.newContext(test.info().project.use);
      const desk2 = await elsewhere.newPage();
      await signIn(desk2, 'desk.koramangala@clinicmx.test');
      await desk2.goto('/app/packages?show=expired');
      await expect(desk2.getByTestId('package-row').filter({ hasText: patient.name })).toHaveCount(
        0,
      );
      await elsewhere.close();

      // The physio sees the sessions on the patient record, and no price anywhere on it.
      await moveValidUntil(patient.id, packageValidUntil(new Date(), 3));
      const clinician = await browser.newContext(test.info().project.use);
      const physioPage = await clinician.newPage();
      await signInWithCode(physioPage, physio.email, physio.secret);
      await physioPage.goto(`/app/patients/${patient.id}`);
      await expect(physioPage.getByTestId('package-meter')).toContainText('0 of 12 used');
      await expect(physioPage.locator('main')).not.toContainText('₹');
      await clinician.close();

      // Paid by mistake: the undo cancels the package.
      await page.goto(href);
      await offer.locator('summary', { hasText: 'Undo payment' }).click();
      await offer.getByLabel('Why is it undone?').fill('Wrong package');
      await offer.getByRole('button', { name: 'Undo payment' }).click();
      await expect(offer).toContainText('Unpaid');
      await expect(meter).toContainText('Cancelled');
      await expect(meter).toContainText('The payment was undone.');
    } finally {
      await restorePrices(snapshot);
    }
  });
});
