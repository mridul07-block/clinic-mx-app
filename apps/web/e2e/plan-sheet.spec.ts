import { expect, test } from '@playwright/test';
import { centreIdByCode, removeCalendarRows, startedAppointment } from './calendar';
import { signedConsultation } from './consultations';
import { removePipelineRows } from './intake';
import { consultationTypeId, submittedWithAlert } from './my-patients';
import { testPatient } from './patients';
import { plannedModality, testPackage } from './plan-sheet';
import { restorePrices, snapshotPrices } from './prices';
import { exclusively, signIn, signInWithCode, temporaryDesk, temporaryWithCode } from './staff';

// BIL-01 done when: the front desk sees the recommended plan read only, and per session and package
// options calculated from the price master. Decisions (user, 25 October 2026): the desk picks the
// session type; modalities priced per use beside the total; packages covering the session type;
// the desk sees only what pricing needs of the plan.

const physios: string[] = [];
const visits: string[] = [];
test.afterEach(async () => {
  await removePipelineRows(visits.splice(0));
  if (physios.length) await removeCalendarRows(physios.splice(0));
});

test('the desk prices a signed plan per session and as a package', async ({ page, browser }) => {
  const physio = await temporaryWithCode('physiotherapist', ['HSR Layout'], { consultant: true });
  physios.push(physio.id);
  const patient = await testPatient();
  const visit = await startedAppointment(physio.id, patient.id, 50, {
    minutes: 45,
    values: {
      appointmentTypeId: await consultationTypeId(),
      status: 'completed',
      completedAt: new Date(),
    },
  });
  visits.push(visit.id);
  await submittedWithAlert(visit.id, patient.id);
  const { consultationId, conditionName } = await signedConsultation(visit.id, physio.id);
  await plannedModality(consultationId, 'radial_shockwave');

  await exclusively('e2e prices', async () => {
    const snapshot = await snapshotPrices();
    try {
      await testPackage({
        name: 'E2E Ten sessions',
        sessions: 10,
        pricePaise: 9_000_00,
        itemKey: 'rehabilitation_session',
      });

      // From Today's Done row.
      const desk = await temporaryDesk();
      await signIn(page, desk.email);
      await page.goto(`/app/today?centre=${await centreIdByCode('HSR')}`);
      await page.getByRole('link', { name: `Plan and payment for ${patient.name}` }).click();
      await expect(page.getByRole('heading', { name: 'Plan and payment' })).toBeVisible();

      const plan = page.getByTestId('recommended-plan');
      await expect(plan).toContainText('2 a week for 6 weeks');
      await expect(plan).toContainText('12');
      await expect(plan).toContainText('Radial Shockwave');
      await expect(plan).toContainText(physio.name);
      // Nothing clinical for the desk.
      await expect(page.locator('main')).not.toContainText(conditionName);
      await expect(page.locator('main')).not.toContainText('Climb stairs without pain');

      const perSession = page.getByTestId('per-session');
      await expect(perSession).toContainText('12 sessions × ₹1,000');
      await expect(perSession).toContainText('₹12,000');
      await expect(page.getByTestId('modality-prices')).toContainText(
        /Radial Shockwave.*₹750 per use/,
      );
      const option = page.getByTestId('package-option').filter({ hasText: 'E2E Ten sessions' });
      await expect(option).toContainText('₹9,000');
      await expect(option).toContainText('10 sessions · ₹900 a session');
      await expect(option).toContainText('Covers 10 of 12 planned sessions');
      await expect(option).toContainText('Valid 3 months from payment');
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true);
      await page.screenshot({ path: test.info().outputPath('plan-sheet.png'), fullPage: true });

      // The advanced session: its price, and no package covers it.
      await page.getByRole('radio', { name: /Advanced rehabilitation session/ }).check();
      await page.getByRole('button', { name: 'Update' }).click();
      await expect(perSession).toContainText('₹18,000');
      await expect(page.getByTestId('no-packages')).toBeVisible();
    } finally {
      await restorePrices(snapshot);
    }
  });

  // A physio without bill amounts is refused; the desk at another centre sees no plan to price.
  const href = new URL(page.url()).pathname;
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
  // Patient records are shared across centres; the plan's pricing is not (its centre only).
  await expect(desk2.getByTestId('no-plan')).toBeVisible();
  await expect(desk2.locator('main')).not.toContainText('₹');
  await elsewhere.close();
});
