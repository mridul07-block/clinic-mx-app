import { istDate } from '@clinic-mx/schemas';
import { expect, test } from '@playwright/test';
import { completeVisit, consultantFee } from './bills';
import { centreIdByCode, removeCalendarRows, startedAppointment } from './calendar';
import { signedConsultation } from './consultations';
import { removePipelineRows } from './intake';
import { checkedIn, consultationTypeId, submittedWithAlert } from './my-patients';
import { testPatient } from './patients';
import { proposedPlan, testPackage } from './plan-sheet';
import { restorePrices, snapshotPrices } from './prices';
import { exclusively, signIn, signInWithCode, temporaryDesk, temporaryWithCode } from './staff';

// SES-01 done when: one tap check in shows "Session n of N" and the gate status. Decisions (user,
// 25 October 2026): N is the plan's planned sessions; checked in Session and treadmill visits are
// numbered in order; the desk still checks in, the physio starts only once the gate is met; until
// Part B consent (BIL-03) payment alone gates.

const physios: string[] = [];
const visits: string[] = [];
test.afterEach(async () => {
  await removePipelineRows(visits.splice(0));
  if (physios.length) await removeCalendarRows(physios.splice(0));
});

/** A patient whose consultation today is signed, with the plan proposed (2 a week for 6 weeks). */
async function proposedPatient(physioId: string, minutesAgo: number) {
  const patient = await testPatient();
  const visit = await startedAppointment(physioId, patient.id, minutesAgo, {
    minutes: 45,
    values: {
      appointmentTypeId: await consultationTypeId(),
      status: 'checked_in',
      arrivedAt: new Date(),
      checkedInBy: physioId,
    },
  });
  visits.push(visit.id);
  await submittedWithAlert(visit.id, patient.id);
  const { consultationId } = await signedConsultation(visit.id, physioId);
  await completeVisit(visit.id);
  await proposedPlan(consultationId);
  return { patient, visit, consultationId };
}

test('a paid session checks in as Session 1 of 12 and starts; an unpaid one is held at the gate', async ({
  page,
  browser,
}) => {
  const physio = await temporaryWithCode('physiotherapist', ['HSR Layout'], { consultant: true });
  physios.push(physio.id);
  await consultantFee(physio.id, 'consultation');
  const paid = await proposedPatient(physio.id, 50);
  const unpaid = await proposedPatient(physio.id, 110);
  test.skip(
    istDate(new Date(Date.now() - 260 * 60_000)) !== istDate(new Date()),
    'The visits would fall on yesterday in IST.',
  );
  const desk = await temporaryDesk();
  const hsr = await centreIdByCode('HSR');
  await exclusively('e2e prices', async () => {
    const snapshot = await snapshotPrices();
    try {
      await testPackage({
        name: 'E2E Twelve sessions',
        sessions: 12,
        pricePaise: 10_000_00,
        itemKey: 'rehabilitation_session',
      });
      // The first patient chooses the package and pays: the episode is Active.
      await signIn(page, desk.email);
      await page.goto(`/app/today?centre=${hsr}`);
      await page.getByRole('link', { name: `Plan and payment for ${paid.patient.name}` }).click();
      await expect(page.getByRole('heading', { name: 'Plan and payment' })).toBeVisible();
      const paidEpisode = new URL(page.url()).pathname.split('/').at(-1) ?? '';
      const form = page.getByTestId('plan-choice-form');
      await form.getByRole('radio', { name: /Package: E2E Twelve sessions/ }).check();
      await form.getByRole('button', { name: 'Record choice' }).click();
      const offer = page.getByTestId('bill').filter({ hasText: 'E2E Twelve sessions' });
      await offer.getByRole('radio', { name: 'UPI QR' }).check();
      await offer.getByRole('button', { name: 'Mark paid ₹10,000' }).click();
      await expect(offer.getByTestId('paid')).toContainText('Paid by UPI QR');
      await page.goto(`/app/today?centre=${hsr}`);
      await page.getByRole('link', { name: `Plan and payment for ${unpaid.patient.name}` }).click();
      await expect(page.getByRole('heading', { name: 'Plan and payment' })).toBeVisible();
      const unpaidEpisode = new URL(page.url()).pathname.split('/').at(-1) ?? '';

      // A session for each, earlier today; the unpaid patient's is checked in already.
      const paidSession = await startedAppointment(physio.id, paid.patient.id, 170, {
        minutes: 30,
        values: { episodeId: paidEpisode, status: 'booked' },
      });
      const unpaidSession = await startedAppointment(physio.id, unpaid.patient.id, 230, {
        minutes: 30,
        values: { episodeId: unpaidEpisode, status: 'booked' },
      });
      await checkedIn(unpaidSession.id, desk.id);

      // One tap: the desk checks the paid session in and reads Session 1 of 12.
      await page.goto(`/app/today?centre=${hsr}`);
      const drawer = page.getByRole('complementary', { name: 'Check in' });
      await page
        .getByTestId('today-row')
        .filter({ hasText: paid.patient.name })
        .filter({ hasText: 'Session ·' })
        .getByRole('link', { name: `Check in ${paid.patient.name}` })
        .click();
      await expect(drawer.getByText('Part B consent is not checked yet.')).toBeVisible();
      await drawer.getByLabel('I have checked who this is (name and date of birth)').check();
      await drawer.getByRole('button', { name: 'Check in', exact: true }).click();
      await expect(drawer.getByTestId('session-progress')).toHaveText(
        'Session 1 of 12, payment complete',
      );
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true);
      await page.screenshot({ path: test.info().outputPath('session-drawer.png'), fullPage: true });

      // Today: the paid one numbered, the unpaid one held at the gate.
      await page.goto(`/app/today?centre=${hsr}`);
      const rowOf = (name: string) =>
        page.getByTestId('today-row').filter({ hasText: name }).filter({ hasText: 'Session ·' });
      await expect(rowOf(paid.patient.name).getByTestId('session-label')).toHaveText(
        'Session 1 of 12',
      );
      await expect(rowOf(unpaid.patient.name).getByTestId('session-gate')).toHaveText(
        'Gate blocked',
      );

      // The physio starts the paid session; the unpaid one says why it cannot start.
      const clinician = await browser.newContext(test.info().project.use);
      const physioPage = await clinician.newPage();
      await signInWithCode(physioPage, physio.email, physio.secret);
      await physioPage.goto('/app/my-patients');
      const mine = (id: string) =>
        physioPage.locator(`[data-testid="my-patient"][data-appointment="${id}"]`);
      await expect(mine(paidSession.id).getByTestId('session-label')).toHaveText('Session 1 of 12');
      await expect(mine(unpaidSession.id).getByTestId('session-gate')).toHaveText(
        'Gate blocked: Consent and payment are needed before the first session.',
      );
      await expect(mine(unpaidSession.id).getByRole('button')).toHaveCount(0);
      await physioPage.screenshot({
        path: test.info().outputPath('session-my-patients.png'),
        fullPage: true,
      });
      await mine(paidSession.id)
        .getByRole('button', { name: `Start session for ${paid.patient.name}` })
        .click();
      await expect(mine(paidSession.id)).toContainText(/With you since \d\d:\d\d/);
      await clinician.close();
    } finally {
      await restorePrices(snapshot);
    }
  });
});
