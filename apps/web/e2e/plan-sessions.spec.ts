import { addDays, istDate, isoWeekday } from '@clinic-mx/schemas';
import { expect, test } from '@playwright/test';
import { completeVisit } from './bills';
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
import { planSeriesOf, proposedPlan, testPackage } from './plan-sheet';
import { restorePrices, snapshotPrices } from './prices';
import { exclusively, signIn, temporaryDesk, temporaryWithCode } from './staff';

// SCH-11 done when: "Book plan sessions" books the whole plan at once from a recurring pattern;
// a date that is not free offers alternatives; one WhatsApp list is queued. Decisions (user, 26
// October 2026): the plan's count capped by the package; weekdays and one time with the treating
// physio; the nearest free times that day, the next day, or Skip; once the episode is Active.

const weekdayChips = [/^Mon$/, /^Tue$/, /^Wed$/, /^Thu$/, /^Fri$/, /^Sat$/, /^Sun$/];

const physios: string[] = [];
const visits: string[] = [];
test.afterEach(async () => {
  await removePipelineRows(visits.splice(0));
  if (physios.length) await removeCalendarRows(physios.splice(0));
});

test('the desk books the plan’s sessions at once, resolving a clash, once the plan is paid', async ({
  page,
}) => {
  test.slow();
  const physio = await temporaryWithCode('physiotherapist', ['HSR Layout'], { consultant: true });
  physios.push(physio.id);
  await physioAtHsr(physio.id, { consultant: true, feeKey: 'consultation' });
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
  // The fixture's plan: 2 a week for 6 weeks, treated by this physio.
  const { consultationId } = await signedConsultation(visit.id, physio.id);
  await completeVisit(visit.id);
  await proposedPlan(consultationId);

  // Tomorrow on, so every date is ahead whatever the clock says; another patient holds 10:00.
  const first = addDays(istDate(new Date()), 1);
  const second = addDays(first, 3);
  const other = await testPatient();
  await testAppointment(physio.id, other.id, first, 600);

  const desk = await temporaryDesk();
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
      const section = page.getByTestId('plan-sessions');

      // Chosen but not paid: nothing to book yet.
      const choice = page.getByTestId('plan-choice-form');
      await choice.getByRole('radio', { name: /Package: E2E Twelve sessions/ }).check();
      await choice.getByRole('button', { name: 'Record choice' }).click();
      await expect(section.getByTestId('plan-sessions-unpaid')).toHaveText(
        'Book plan sessions once the plan is paid.',
      );

      // Paid: the episode is Active and 12 sessions are left to book.
      const bill = page.getByTestId('bill').filter({ hasText: 'E2E Twelve sessions' });
      await bill.getByRole('radio', { name: 'UPI QR' }).check();
      await bill.getByRole('button', { name: 'Mark paid ₹10,000' }).click();
      await expect(section.getByTestId('plan-sessions-counts')).toHaveText(
        '12 planned · 0 booked · 0 done · 12 to book · package: 12 left',
      );

      // One day ticked for a plan of 2 a week is refused.
      const form = section.getByTestId('plan-sessions-form');
      await form.getByLabel('Start date').fill(first);
      const day = (date: string) =>
        form.locator('label').filter({ hasText: weekdayChips[isoWeekday(date) - 1] ?? /^$/ });
      await day(first).click();
      await form.getByLabel('Time').fill('10:00');
      await expect(form.getByLabel('Physio')).toHaveValue(physio.id);
      await form.getByRole('button', { name: 'Check dates' }).click();
      await expect(form).toContainText('Tick 2 days: the plan is 2 a week.');

      // Two days: 12 dates, the first taken, with the nearest times and the next day offered.
      await day(second).click();
      await form.getByRole('button', { name: 'Check dates' }).click();
      await expect(form.getByTestId('plan-session-date')).toHaveCount(11);
      const clash = form.getByTestId('plan-session-clash');
      await expect(clash).toHaveCount(1);
      await expect(clash).toContainText('The physio is booked then');
      await expect(clash.getByRole('radio')).toHaveCount(5);
      await expect(clash.getByRole('radio', { name: /^Next day, / })).toHaveCount(1);
      await expect(clash.getByRole('radio', { name: 'Skip' })).toHaveCount(1);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true);
      await page.screenshot({ path: test.info().outputPath('plan-sessions.png'), fullPage: true });

      // Booking waits for a pick on the clash, then books all 12 at once.
      await form.getByRole('button', { name: 'Book sessions' }).click();
      await expect(form).toContainText('Pick a time or Skip for each date that is not free.');
      await form.getByTestId('plan-session-clash').getByRole('radio').first().check();
      await form.getByRole('button', { name: 'Book sessions' }).click();
      const booked = section.getByTestId('plan-sessions-booked');
      await expect(booked).toContainText(
        'Booked 12 sessions. The plan sessions list is queued for WhatsApp.',
      );
      await expect(booked.getByRole('listitem')).toHaveCount(12);
      await page.screenshot({
        path: test.info().outputPath('plan-sessions-booked.png'),
        fullPage: true,
      });
      expect(await planSeriesOf(patient.id)).toEqual({ appointments: 12, series: 1, lists: 1 });

      // Nothing left to book.
      await page.reload();
      await expect(section.getByTestId('plan-sessions-counts')).toHaveText(
        '12 planned · 12 booked · 0 done · 0 to book · package: 12 left',
      );
      await expect(section.getByTestId('plan-sessions-all-booked')).toBeVisible();
    } finally {
      await restorePrices(snapshot);
    }
  });
});
