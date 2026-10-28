import { expect, test } from '@playwright/test';
import { completeVisit, consultantFee } from './bills';
import { centreIdByCode, removeCalendarRows, startedAppointment } from './calendar';
import { signedConsultation } from './consultations';
import { removePipelineRows } from './intake';
import { consultationTypeId, submittedWithAlert } from './my-patients';
import { testPatient } from './patients';
import { restorePrices, snapshotPrices, testDiscount } from './prices';
import { exclusively, signIn, signInWithCode, temporaryDesk, temporaryWithCode } from './staff';

// BIL-07 done when: preset types at the desk; other discounts need Finance approval (decision
// 15). Recommended defaults chosen under the user's standing approval, 28 October 2026: the desk
// applies a preset from the clinic's list to an unpaid bill; Finance or the Super Admin applies
// any other discount with a reason, which records their approval; the total and the payment are
// the bill less its discount, never ₹0.

const physios: string[] = [];
const visits: string[] = [];
test.afterEach(async () => {
  await removePipelineRows(visits.splice(0));
  if (physios.length) await removeCalendarRows(physios.splice(0));
});

test('the desk applies a preset, Finance another discount with its reason, then the net is paid', async ({
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
  await signedConsultation(visit.id, physio.id);
  await completeVisit(visit.id);

  const desk = await temporaryDesk();
  const finance = await temporaryWithCode('finance');
  await exclusively('e2e prices', async () => {
    const snapshot = await snapshotPrices();
    try {
      await testDiscount('E2E Staff family', 10);
      await signIn(page, desk.email);
      await page.goto(`/app/today?centre=${await centreIdByCode('HSR')}`);
      await page.getByRole('link', { name: `Plan and payment for ${patient.name}` }).click();
      await expect(page.getByRole('heading', { name: 'Plan and payment' })).toBeVisible();
      const href = new URL(page.url()).pathname;
      const fee = page.getByTestId('bill').filter({ hasText: 'Consultation fee' });

      // The desk: a preset from the list, never another discount.
      await fee.locator('summary', { hasText: 'Apply a discount' }).click();
      await expect(fee.getByRole('radio', { name: 'Other discount' })).toHaveCount(0);
      await fee.getByRole('button', { name: 'Apply discount' }).click();
      await expect(fee).toContainText('Choose a discount.');
      await fee.getByRole('radio', { name: /E2E Staff family/ }).check();
      await fee.getByRole('button', { name: 'Apply discount' }).click();
      const off = fee.getByTestId('bill-discount');
      await expect(off).toContainText('Less: E2E Staff family (10%)');
      await expect(off).toContainText('-₹75');
      await expect(off).toContainText(`By ${desk.name}`);
      await expect(fee.getByRole('button', { name: 'Mark paid ₹675' })).toBeVisible();
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true);
      await page.screenshot({ path: test.info().outputPath('discount-desk.png'), fullPage: true });

      // Finance, from Unpaid: any other discount, with the reason recorded as the approval.
      const finances = await browser.newContext(test.info().project.use);
      const financePage = await finances.newPage();
      await signInWithCode(financePage, finance.email, finance.secret);
      await financePage.goto('/app/finance/unpaid');
      await financePage
        .getByTestId('unpaid-row')
        .filter({ hasText: '₹675' })
        .getByRole('link')
        .first()
        .click();
      await expect.poll(() => new URL(financePage.url()).pathname).toBe(href);
      const theirs = financePage.getByTestId('bill').filter({ hasText: 'Consultation fee' });
      await theirs.locator('summary', { hasText: 'Change the discount' }).click();
      await theirs.getByRole('radio', { name: 'Other discount' }).check();
      await theirs.getByLabel('Percent', { exact: true }).fill('20');
      await theirs.getByRole('button', { name: 'Apply discount' }).click();
      await expect(theirs).toContainText('Say why this discount is given.');
      await theirs.getByLabel('Reason', { exact: true }).fill('Hardship, agreed with the patient');
      await theirs.getByRole('button', { name: 'Apply discount' }).click();
      await expect(theirs.getByTestId('bill-discount')).toContainText('Less: Other discount (20%)');
      await expect(theirs.getByTestId('bill-discount')).toContainText(
        'Hardship, agreed with the patient',
      );
      await finances.close();

      // The desk can no longer change it, and takes the net amount.
      await page.reload();
      await expect(fee.getByTestId('bill-discount')).toContainText('-₹150');
      await expect(fee.getByTestId('bill-discount')).toContainText(`By ${finance.name}`);
      await expect(fee.getByTestId('discount-form')).toHaveCount(0);
      await expect(fee.getByRole('button', { name: 'Remove the discount' })).toHaveCount(0);
      await fee.getByRole('radio', { name: 'Cash' }).check();
      await fee.getByRole('button', { name: 'Mark paid ₹600' }).click();
      await expect(fee.getByTestId('paid')).toContainText('Paid by Cash');
      await expect(fee.getByTestId('bill-discount')).toContainText('-₹150');
    } finally {
      // The discounted bill goes before the test preset it names.
      await removePipelineRows(visits.splice(0));
      if (physios.length) await removeCalendarRows(physios.splice(0));
      await restorePrices(snapshot);
    }
  });
});
