import { expect, test } from '@playwright/test';
import { completeVisit, consultantFee } from './bills';
import { centreIdByCode, removeCalendarRows, startedAppointment } from './calendar';
import { recordViews, signedConsultation } from './consultations';
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
// SES-02 done when: the physio who starts the session sees the summary card of its episode, from
// the signed plan with no AI sheet. Decisions (user, 25 October 2026): a session screen opened by
// Start session and Open session; the phase line waits for OUT-04 (DECISION SES-02); only the
// appointment's physio opens it, the Super Admin reads it.

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
  const { consultationId, conditionName } = await signedConsultation(visit.id, physioId);
  await completeVisit(visit.id);
  await proposedPlan(consultationId);
  return { patient, visit, consultationId, conditionName };
}

test('a paid session checks in as Session 1 of 12 and starts on its summary card; an unpaid one is held at the gate', async ({
  page,
  browser,
}) => {
  const physio = await temporaryWithCode('physiotherapist', ['HSR Layout'], { consultant: true });
  physios.push(physio.id);
  await consultantFee(physio.id, 'consultation');
  const paid = await proposedPatient(physio.id, 50);
  const unpaid = await proposedPatient(physio.id, 110);
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

      // A session for each today; the unpaid patient's is checked in already.
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

      // SES-02: Start session opens the session screen, the episode's summary card first.
      await expect(physioPage.getByRole('heading', { name: 'Session', exact: true })).toBeVisible();
      expect(new URL(physioPage.url()).pathname).toBe(`/app/sessions/${paidSession.id}`);
      await expect(physioPage.getByTestId('session-label')).toHaveText('Session 1 of 12');
      const card = physioPage.getByTestId('summary-card');
      await expect(card.getByTestId('summary-precautions')).toContainText('Pregnancy');
      await expect(card.getByTestId('summary-diagnosis')).toContainText(paid.conditionName);
      await expect(card.getByTestId('summary-diagnosis')).toContainText(
        'Dynamic valgus on step down',
      );
      await expect(card.getByTestId('summary-plan')).toContainText('Climb stairs without pain');
      await expect(card.getByTestId('summary-plan')).toContainText('2 a week for 6 weeks');
      await expect(card.getByTestId('summary-phase')).toHaveText('Phase: not set up yet');
      await expect(card).toContainText('Last signed note');
      await expect(physioPage.getByTestId('session-read-only')).toHaveCount(0);
      expect(await recordViews(paid.patient.id, physio.id)).toBeGreaterThan(0);
      expect(
        await physioPage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true);
      await physioPage.screenshot({
        path: test.info().outputPath('session-screen.png'),
        fullPage: true,
      });

      // While it runs, My patients opens it again.
      await physioPage.goto('/app/my-patients');
      await expect(mine(paidSession.id)).toContainText(/With you since \d\d:\d\d/);
      await mine(paidSession.id)
        .getByRole('link', { name: `Open session for ${paid.patient.name}` })
        .click();
      await expect(physioPage.getByTestId('summary-card')).toBeVisible();
      expect(new URL(physioPage.url()).pathname).toBe(`/app/sessions/${paidSession.id}`);
      await clinician.close();

      // Another physio at the centre does not even read the appointment (row level security), so
      // it is not found; the desk is not allowed in.
      const other = await temporaryWithCode('physiotherapist', ['HSR Layout']);
      physios.push(other.id);
      const otherContext = await browser.newContext(test.info().project.use);
      const otherPage = await otherContext.newPage();
      await signInWithCode(otherPage, other.email, other.secret);
      await otherPage.goto(`/app/sessions/${paidSession.id}`);
      await expect(
        otherPage.getByRole('heading', { name: 'This page could not be found.' }),
      ).toBeVisible();
      await expect(otherPage.getByTestId('summary-card')).toHaveCount(0);
      await otherContext.close();
      await page.goto(`/app/sessions/${paidSession.id}`);
      await expect(
        page.getByRole('heading', { name: 'You do not have access to this page' }),
      ).toBeVisible();
    } finally {
      await restorePrices(snapshot);
    }
  });
});
