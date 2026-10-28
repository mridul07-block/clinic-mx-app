import { expect, test } from '@playwright/test';
import { completeVisit, consultantFee } from './bills';
import { centreIdByCode, removeCalendarRows, startedAppointment } from './calendar';
import { signedConsultation } from './consultations';
import { removePipelineRows } from './intake';
import { consultationTypeId, submittedWithAlert } from './my-patients';
import { testPatient } from './patients';
import { proposedPlan, testPackage } from './plan-sheet';
import { restorePrices, snapshotPrices } from './prices';
import { exclusively, signIn, signInWithCode, temporaryDesk, temporaryWithCode } from './staff';

// BIL-11 done when: Finance only; reason and approver stored (decisions 9, 12). Recommended
// defaults chosen under the user's standing approval, 28 October 2026: Finance or the Super Admin
// finds a paid bill by its number and records money given back, never more than was paid, with
// how and why; their name is the approval. A full refund closes the live package; the desk can no
// longer undo the payment. Credits wait for the client.

const physios: string[] = [];
const visits: string[] = [];
test.afterEach(async () => {
  await removePipelineRows(visits.splice(0));
  if (physios.length) await removeCalendarRows(physios.splice(0));
});

test('Finance refunds part of a package, then the rest, which closes it; the desk sees both', async ({
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
  const finance = await temporaryWithCode('finance');
  await exclusively('e2e prices', async () => {
    const snapshot = await snapshotPrices();
    try {
      await testPackage({
        name: 'E2E Ten sessions',
        sessions: 10,
        pricePaise: 9_000_00,
        itemKey: 'rehabilitation_session',
      });
      // The desk records the package and takes ₹9,000 by UPI.
      await signIn(page, desk.email);
      await page.goto(`/app/today?centre=${await centreIdByCode('HSR')}`);
      await page.getByRole('link', { name: `Plan and payment for ${patient.name}` }).click();
      const form = page.getByTestId('plan-choice-form');
      await form.getByRole('radio', { name: /Package: E2E Ten sessions/ }).check();
      await form.getByRole('button', { name: 'Record choice' }).click();
      const offer = page.getByTestId('bill').filter({ hasText: 'E2E Ten sessions' });
      await offer.getByRole('radio', { name: 'UPI QR' }).check();
      await offer.getByRole('button', { name: 'Mark paid ₹9,000' }).click();
      await expect(offer.getByTestId('paid')).toContainText('Paid by UPI QR');
      const billNumber = (await offer.locator('span.font-mono').first().innerText()).trim();

      // Finance finds it by number and refunds part of it.
      const finances = await browser.newContext(test.info().project.use);
      const financePage = await finances.newPage();
      await signInWithCode(financePage, finance.email, finance.secret);
      await financePage.goto('/app/finance/refunds');
      await expect(
        financePage.getByTestId('no-refunds').or(financePage.getByTestId('refunds')),
      ).toBeVisible();
      await financePage.getByLabel('Bill or invoice number').fill(billNumber.toLowerCase());
      await financePage.getByRole('button', { name: 'Find' }).click();
      const found = financePage.getByTestId('refund-payment');
      await expect(found).toContainText('₹9,000');
      await expect(financePage.getByTestId('refund-package')).toContainText(
        'closes the package E2E Ten sessions: 0 of 10 sessions used',
      );
      const refundForm = financePage.getByTestId('refund-form');
      await refundForm.getByLabel('Amount in rupees').fill('2,000');
      await refundForm.getByRole('radio', { name: 'Cash' }).check();
      await refundForm.getByRole('button', { name: 'Record refund' }).click();
      await expect(refundForm).toContainText('Say why the money is refunded.');
      await refundForm.getByLabel('Why is it refunded?').fill('Two sessions missed for travel');
      await refundForm.getByRole('button', { name: 'Record refund' }).click();
      await expect(financePage.getByText('The refund is recorded.')).toBeVisible();
      const row = financePage.getByTestId('refund-row').filter({ hasText: billNumber });
      await expect(row).toContainText('₹2,000');
      await expect(row).toContainText(`Approved by ${finance.name}`);

      // Never more than is left.
      await financePage.goto(`/app/finance/refunds?number=${billNumber}`);
      await expect(financePage.getByTestId('refunded-so-far')).toHaveText('₹2,000');
      const again = financePage.getByTestId('refund-form');
      await again.getByLabel('Amount in rupees').fill('8000');
      await again.getByRole('radio', { name: 'UPI QR' }).check();
      await again.getByLabel('Why is it refunded?').fill('Moved to another city');
      await again.getByRole('button', { name: 'Record refund' }).click();
      await expect(again).toContainText('That is more than is left to refund on this payment.');
      expect(
        await financePage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true);
      // The open tab, the fifth, is scrolled into view on a phone.
      await expect
        .poll(() =>
          financePage
            .getByTestId('tab-refunds')
            .evaluate((tab) => tab.getBoundingClientRect().right <= window.innerWidth),
        )
        .toBe(true);
      await financePage.screenshot({
        path: test.info().outputPath('refunds.png'),
        fullPage: true,
      });

      // The desk sees the refund and can no longer undo the payment.
      await page.reload();
      await expect(offer.getByTestId('refund')).toContainText(`Refunded ₹2,000 by Cash`);
      await expect(offer.getByTestId('refund')).toContainText(`Approved by ${finance.name}`);
      await expect(offer.locator('summary', { hasText: 'Undo payment' })).toHaveCount(0);

      // The rest closes the package.
      await again.getByLabel('Amount in rupees').fill('7000');
      await again.getByRole('button', { name: 'Record refund' }).click();
      await expect(financePage.getByText('This payment is refunded in full.')).toBeVisible();
      await finances.close();
      await page.reload();
      await expect(offer.getByTestId('refund')).toHaveCount(2);
      await expect(page.getByText('Refunded.')).toBeVisible();

      // Refunds are Finance's: the desk is sent away.
      await page.goto('/app/finance/refunds');
      await expect(page).toHaveURL(/\/app\/not-allowed/);
    } finally {
      await removePipelineRows(visits.splice(0));
      if (physios.length) await removeCalendarRows(physios.splice(0));
      await restorePrices(snapshot);
    }
  });
});
