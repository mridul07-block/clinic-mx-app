import { istDate } from '@clinic-mx/schemas';
import { expect, test } from '@playwright/test';
import { completeVisit, consultantFee } from './bills';
import { centreIdByCode, removeCalendarRows, startedAppointment } from './calendar';
import { signedConsultation } from './consultations';
import { removePipelineRows } from './intake';
import { consultationTypeId, submittedWithAlert } from './my-patients';
import { testPatient } from './patients';
import { proposedPlan, testPackage } from './plan-sheet';
import { restorePrices, snapshotPrices } from './prices';
import { exclusively, signIn, temporaryDesk, temporaryWithCode } from './staff';

// BIL-06 done when: UPI QR, card or cash with an optional reference; the bill is marked paid.
// Decisions (user, 25 October 2026): the whole total only (decision 10); paying for the chosen
// plan makes the episode Active; a mistake is undone on its day with a reason; the reference is
// optional.

const physios: string[] = [];
const visits: string[] = [];
test.afterEach(async () => {
  await removePipelineRows(visits.splice(0));
  if (physios.length) await removeCalendarRows(physios.splice(0));
});

test('the desk marks bills paid, the paid package makes the plan Active, and a mistake is undone', async ({
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
  let href = '';
  await exclusively('e2e prices', async () => {
    const snapshot = await snapshotPrices();
    try {
      await testPackage({
        name: 'E2E Ten sessions',
        sessions: 10,
        pricePaise: 9_000_00,
        itemKey: 'rehabilitation_session',
      });
      await signIn(page, desk.email);
      const today = `/app/today?centre=${await centreIdByCode('HSR')}`;
      await page.goto(today);
      await page.getByRole('link', { name: `Plan and payment for ${patient.name}` }).click();
      await expect(page.getByRole('heading', { name: 'Plan and payment' })).toBeVisible();
      href = new URL(page.url()).pathname;

      // No method picked: refused, nothing recorded.
      const fee = page.getByTestId('bill').filter({ hasText: 'Consultation fee' });
      await fee.getByRole('button', { name: 'Mark paid ₹750' }).click();
      await expect(fee).toContainText('Choose how the patient paid.');
      await expect(fee).toContainText('Unpaid');

      // The package chosen and paid by UPI with its reference: the plan is Active.
      const form = page.getByTestId('plan-choice-form');
      await form.getByRole('radio', { name: /Package: E2E Ten sessions/ }).check();
      await form.getByRole('button', { name: 'Record choice' }).click();
      const offer = page.getByTestId('bill').filter({ hasText: 'E2E Ten sessions' });
      await offer.getByRole('radio', { name: 'UPI QR' }).check();
      await offer.getByLabel('Reference (optional)').fill('UPI-E2E-1');
      await offer.getByRole('button', { name: 'Mark paid ₹9,000' }).click();
      await expect(offer.getByTestId('paid')).toContainText('Paid by UPI QR · Ref UPI-E2E-1');
      await expect(offer.getByTestId('paid')).toContainText(`Recorded by ${desk.name}`);
      await expect(offer).toContainText('Paid');
      await expect(
        page.getByTestId('sheet-header').getByText('Active', { exact: true }),
      ).toBeVisible();
      await expect(page.getByTestId('plan-choice-form')).toHaveCount(0);

      // The fee by cash: Today no longer shows it unpaid.
      await fee.getByRole('radio', { name: 'Cash' }).check();
      await fee.getByRole('button', { name: 'Mark paid ₹750' }).click();
      await expect(fee.getByTestId('paid')).toContainText('Paid by Cash');
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true);
      await page.screenshot({ path: test.info().outputPath('payments.png'), fullPage: true });
      await page.goto(today);
      await expect(page.getByRole('listitem').filter({ hasText: patient.name })).not.toContainText(
        'Unpaid',
      );

      // Recorded by mistake: undone the same day with the reason; the fee is unpaid again.
      await page.goto(href);
      await fee.locator('summary', { hasText: 'Undo payment' }).click();
      await fee.getByLabel('Why is it undone?').fill('Recorded against the wrong bill');
      await fee.getByRole('button', { name: 'Undo payment' }).click();
      await expect(fee).toContainText('Unpaid');
      await expect(fee.getByTestId('paid')).toHaveCount(0);
      await expect(fee.getByRole('button', { name: 'Mark paid ₹750' })).toBeVisible();
    } finally {
      await restorePrices(snapshot);
    }
  });

  // The desk at another centre sees no bills to take payment for.
  const elsewhere = await browser.newContext(test.info().project.use);
  const desk2 = await elsewhere.newPage();
  await signIn(desk2, 'desk.koramangala@clinicmx.test');
  await desk2.goto(href);
  await expect(desk2.getByTestId('bill')).toHaveCount(0);
  await expect(desk2.getByTestId('payment-form')).toHaveCount(0);
  await elsewhere.close();
});
