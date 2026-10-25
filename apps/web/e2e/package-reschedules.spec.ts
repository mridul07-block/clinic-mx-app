import { addDays, istDate } from '@clinic-mx/schemas';
import { expect, test, type Page } from '@playwright/test';
import { completeVisit, consultantFee } from './bills';
import {
  centreIdByCode,
  physioAtHsr,
  removeCalendarRows,
  startedAppointment,
  testAppointment,
} from './calendar';
import { signedConsultation } from './consultations';
import { removePipelineRows } from './intake';
import { consultationTypeId, submittedWithAlert } from './my-patients';
import { testPatient } from './patients';
import { proposedPlan, testPackage } from './plan-sheet';
import { restorePrices, snapshotPrices } from './prices';
import { exclusively, signIn, temporaryDesk, temporaryWithCode } from './staff';

// SCH-10 done when: 1 reschedule per 10 booked sessions; Zero Gravity Treadmill package sessions
// never moved at the patient's request. Decisions (user, 25 October 2026): Session and treadmill
// appointments in an episode with an active package; only moves asked by the patient use one;
// with none left the desk is refused, and a move asked by the clinic is always possible.

const physios: string[] = [];
const visits: string[] = [];
test.afterEach(async () => {
  await removePipelineRows(visits.splice(0));
  if (physios.length) await removeCalendarRows(physios.splice(0));
});

const sheet = (page: Page, name: string) => page.getByRole('complementary', { name });

test('a package session moved at the patient’s request uses the allowance, then only the clinic may move it', async ({
  page,
}, testInfo) => {
  const physio = await temporaryWithCode('physiotherapist', ['HSR Layout'], { consultant: true });
  physios.push(physio.id);
  await physioAtHsr(physio.id);
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
  const hsr = await centreIdByCode('HSR');
  const day = addDays(istDate(new Date()), 7);
  await exclusively('e2e prices', async () => {
    const snapshot = await snapshotPrices();
    try {
      await testPackage({
        name: 'E2E Twelve sessions',
        sessions: 12,
        pricePaise: 10_000_00,
        itemKey: 'rehabilitation_session',
      });
      // The package chosen and paid: 1 reschedule (12 sessions).
      await signIn(page, desk.email);
      await page.goto(`/app/today?centre=${hsr}`);
      await page.getByRole('link', { name: `Plan and payment for ${patient.name}` }).click();
      await expect(page.getByRole('heading', { name: 'Plan and payment' })).toBeVisible();
      const planHref = new URL(page.url()).pathname;
      const episodeId = planHref.split('/').at(-1) ?? '';
      const form = page.getByTestId('plan-choice-form');
      await form.getByRole('radio', { name: /Package: E2E Twelve sessions/ }).check();
      await form.getByRole('button', { name: 'Record choice' }).click();
      const offer = page.getByTestId('bill').filter({ hasText: 'E2E Twelve sessions' });
      await offer.getByRole('radio', { name: 'UPI QR' }).check();
      await offer.getByRole('button', { name: 'Mark paid ₹10,000' }).click();
      await expect(page.getByTestId('package-meter')).toContainText('1 reschedule left');

      // A Session of the package a week ahead, moved at the patient's request.
      await testAppointment(physio.id, patient.id, day, 10 * 60, episodeId);
      await page.goto(`/app/calendar?centre=${hsr}&date=${day}&physio=${physio.id}`);
      await page
        .getByTestId(testInfo.project.name === 'phone' ? 'agenda-row' : 'calendar-block')
        .filter({ hasText: patient.name })
        .click();
      await sheet(page, 'Appointment').getByRole('link', { name: 'Reschedule' }).click();
      const picker = sheet(page, 'Reschedule');
      await expect(picker.getByTestId('package-reschedules')).toHaveText(
        'Package session: 1 reschedule left. A move asked by the patient uses one.',
      );
      await picker.getByRole('button', { name: `Move to 11:00 with ${physio.name}` }).click();
      const confirm = sheet(page, 'Reschedule');
      await expect(confirm.getByTestId('package-reschedules')).toContainText('1 reschedule left');
      await confirm.getByRole('radio', { name: 'By the patient' }).check();
      await confirm.getByRole('button', { name: 'Reschedule' }).click();
      const moved = sheet(page, 'Appointment');
      await expect(moved.getByTestId('moved')).toContainText(/Rescheduled to MVH-\d{5}/);

      // None left: the patient's request is refused, the clinic's goes through.
      await page.goto(`/app/calendar?centre=${hsr}&date=${day}&physio=${physio.id}`);
      await page
        .getByTestId(testInfo.project.name === 'phone' ? 'agenda-row' : 'calendar-block')
        .filter({ hasText: patient.name })
        .filter({ hasText: '11:00' })
        .first()
        .click();
      await sheet(page, 'Appointment').getByRole('link', { name: 'Reschedule' }).click();
      const again = sheet(page, 'Reschedule');
      await expect(again.getByTestId('package-reschedules')).toHaveText(
        'Package session: no reschedules left. Only a move asked by the clinic is possible.',
      );
      await again.getByRole('button', { name: `Move to 12:00 with ${physio.name}` }).click();
      const last = sheet(page, 'Reschedule');
      await last.getByRole('radio', { name: 'By the patient' }).check();
      await last.getByRole('button', { name: 'Reschedule' }).click();
      await expect(last).toContainText(
        'No reschedules left in this package. Only a move asked by the clinic is possible.',
      );
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true);
      await page.screenshot({ path: test.info().outputPath('no-reschedules.png'), fullPage: true });
      await last.getByRole('radio', { name: 'By the clinic' }).check();
      await last.getByRole('button', { name: 'Reschedule' }).click();
      await expect(sheet(page, 'Appointment').getByTestId('moved')).toContainText(
        /Rescheduled to MVH-\d{5}/,
      );

      await page.goto(planHref);
      await expect(page.getByTestId('package-meter')).toContainText('0 reschedules left');
    } finally {
      await restorePrices(snapshot);
    }
  });
});
