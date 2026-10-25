import { expect, test, type Page } from '@playwright/test';
import { completeVisit, consultantFee } from './bills';
import { centreIdByCode, removeCalendarRows, startedAppointment } from './calendar';
import { signedConsultation } from './consultations';
import { removePipelineRows } from './intake';
import { consultationTypeId, submittedWithAlert } from './my-patients';
import { testPatient } from './patients';
import { proposedPlan, testPackage } from './plan-sheet';
import { restorePrices, snapshotPrices } from './prices';
import { exclusively, signIn, signInWithCode, temporaryDesk, temporaryWithCode } from './staff';

// BIL-05 done when: the consultation fee by physio level; the fee timing setting; no price edits
// at the desk. Decisions (user, 25 October 2026): the database bills the fee when the timing says
// (after the consultation by default), and a chosen package; HSR-B-00001 numbers; no fee set, no
// bill until the Super Admin sets one and the desk makes it.

const physios: string[] = [];
const visits: string[] = [];
test.afterEach(async () => {
  await removePipelineRows(visits.splice(0));
  if (physios.length) await removeCalendarRows(physios.splice(0));
});

/** A consultant's checked in consultation with the patient's health form; its episode. */
async function consultationVisit(fee: string | null) {
  const physio = await temporaryWithCode('physiotherapist', ['HSR Layout'], { consultant: true });
  physios.push(physio.id);
  await consultantFee(physio.id, fee);
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
  return { physio, patient, visit };
}

async function openSheet(page: Page, patientName: string): Promise<string> {
  await page.getByRole('link', { name: `Plan and payment for ${patientName}` }).click();
  await expect(page.getByRole('heading', { name: 'Plan and payment' })).toBeVisible();
  return new URL(page.url()).pathname;
}

test('the consultation fee is billed when the consultation completes, and a chosen package', async ({
  page,
  browser,
}) => {
  const { physio, patient, visit } = await consultationVisit('consultation');
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
      await page.goto(`/app/today?centre=${await centreIdByCode('HSR')}`);
      await expect(page.getByRole('listitem').filter({ hasText: patient.name })).toContainText(
        'Unpaid ₹750',
      );
      href = await openSheet(page, patient.name);

      const fee = page.getByTestId('bill').filter({ hasText: 'Consultation fee' });
      await expect(fee).toContainText(/HSR-B-\d{5}/);
      await expect(fee).toContainText('Consultation');
      await expect(fee).toContainText('₹750');
      await expect(fee).toContainText('Unpaid');

      // A package chosen: billed at its price, beside the fee.
      const form = page.getByTestId('plan-choice-form');
      await form.getByRole('radio', { name: /Package: E2E Ten sessions/ }).check();
      await form.getByRole('button', { name: 'Record choice' }).click();
      const offer = page.getByTestId('bill').filter({ hasText: 'E2E Ten sessions' });
      await expect(offer).toContainText('₹9,000');
      await expect(offer).toContainText('Unpaid');
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true);
      await page.screenshot({ path: test.info().outputPath('bills.png'), fullPage: true });

      // Chosen differently: that bill is cancelled, the fee stays.
      await form.getByRole('radio', { name: /Pay per session/ }).check();
      await form.getByRole('button', { name: 'Record choice' }).click();
      await expect(offer).toContainText('Cancelled');
      await expect(offer).toContainText('The patient chose differently.');
      await expect(fee).toContainText('Unpaid');
    } finally {
      await restorePrices(snapshot);
    }
  });

  // A physio is refused; the desk at another centre sees no bills.
  const context = await browser.newContext(test.info().project.use);
  const other = await context.newPage();
  await signInWithCode(other, physio.email, physio.secret);
  await other.goto(href);
  await expect(other).toHaveURL(/\/app\/not-allowed/);
  await context.close();
  const elsewhere = await browser.newContext(test.info().project.use);
  const desk2 = await elsewhere.newPage();
  await signIn(desk2, 'desk.koramangala@clinicmx.test');
  await desk2.goto(href);
  await expect(desk2.getByTestId('no-bills')).toBeVisible();
  await expect(desk2.getByTestId('bill')).toHaveCount(0);
  await elsewhere.close();
});

test('with no fee set nothing is billed, until the fee is set and the desk makes the bill', async ({
  page,
}) => {
  const { physio, patient, visit } = await consultationVisit(null);
  await signedConsultation(visit.id, physio.id);
  await completeVisit(visit.id);

  const desk = await temporaryDesk();
  await signIn(page, desk.email);
  await page.goto(`/app/today?centre=${await centreIdByCode('HSR')}`);
  await openSheet(page, patient.name);
  await expect(page.getByTestId('fee-not-set')).toHaveText(
    `Consultation fee not set for ${physio.name}. Ask the Super Admin to set it on Staff.`,
  );
  await expect(page.getByTestId('bill')).toHaveCount(0);

  await consultantFee(physio.id, 'senior_consultation');
  await page.reload();
  await page.getByRole('button', { name: 'Make the consultation bill' }).click();
  const fee = page.getByTestId('bill').filter({ hasText: 'Consultation fee' });
  await expect(fee).toContainText('Senior consultation');
  await expect(fee).toContainText('₹1,000');
  await expect(page.getByTestId('fee-unbilled')).toHaveCount(0);
});
