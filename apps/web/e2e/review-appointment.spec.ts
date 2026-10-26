import { addDays, formatIstDate, istDate } from '@clinic-mx/schemas';
import { expect, test } from '@playwright/test';
import { completeVisit } from './bills';
import { centreIdByCode, physioAtHsr, removeCalendarRows, startedAppointment } from './calendar';
import { signedConsultation } from './consultations';
import { removePipelineRows } from './intake';
import { tickUntil } from './jobs';
import { consultationTypeId, submittedWithAlert } from './my-patients';
import { testPatient } from './patients';
import { activePlan, planReviewDate } from './plan-sheet';
import { signIn, temporaryDesk, temporaryWithCode } from './staff';

// OUT-06 done when: the 6 week Review is booked automatically with the plan, with the consultant.
// Decisions (user, 26 October 2026): once the episode turns Active; with the consultant who signed
// the consultation, on the plan's review date at their first free time, else the following days
// within `scheduling.review_search_days`, else a task for the front desk; no message yet.

const physios: string[] = [];
const visits: string[] = [];
test.afterEach(async () => {
  await removePipelineRows(visits.splice(0));
  if (physios.length) await removeCalendarRows(physios.splice(0));
});

/** A consultant at HSR with `hours`, and their patient's signed plan reviewed on `reviewDate`. */
async function signedPlanWith(hours: { starts: number; ends: number }[], reviewDate: string) {
  const consultant = await temporaryWithCode('physiotherapist', ['HSR Layout'], {
    consultant: true,
  });
  physios.push(consultant.id);
  await physioAtHsr(consultant.id, { consultant: true, feeKey: 'consultation', hours });
  const patient = await testPatient();
  const visit = await startedAppointment(consultant.id, patient.id, 120, {
    minutes: 45,
    values: {
      appointmentTypeId: await consultationTypeId(),
      status: 'checked_in',
      arrivedAt: new Date(),
      checkedInBy: consultant.id,
    },
  });
  visits.push(visit.id);
  await submittedWithAlert(visit.id, patient.id);
  const { consultationId } = await signedConsultation(visit.id, consultant.id);
  await completeVisit(visit.id);
  await planReviewDate(consultationId, reviewDate);
  return { consultant, patient, consultationId };
}

test('turning Active books the Review with the consultant at their first free time on the review date', async ({
  page,
  request,
}) => {
  const reviewDate = addDays(istDate(new Date()), 10);
  const { consultant, patient, consultationId } = await signedPlanWith(
    [{ starts: 10 * 60, ends: 13 * 60 }],
    reviewDate,
  );
  const desk = await temporaryDesk();
  const hsr = await centreIdByCode('HSR');
  await signIn(page, desk.email);
  // Paid: the episode turns Active, and the database queues the booking.
  await activePlan(consultationId);
  // The phone shows the day as an agenda.
  const block = test.info().project.name === 'phone' ? 'agenda-row' : 'calendar-block';
  const review = page.getByTestId(block).filter({ hasText: patient.name });
  await tickUntil(request, async () => {
    await page.goto(`/app/calendar?centre=${hsr}&date=${reviewDate}&physio=${consultant.id}`);
    await expect(review).toHaveCount(1, { timeout: 1000 });
  });
  await expect(review).toContainText('Review');
  await review.click();
  const drawer = page.getByRole('complementary');
  await expect(drawer).toContainText(`${formatIstDate(reviewDate)}, 10:00 to 10:45`);
  await expect(drawer).toContainText(consultant.name);
  await expect(drawer).toContainText('Automatically');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: test.info().outputPath('review-booked.png'), fullPage: true });
});

test('with no free time in the days searched, the front desk gets a task to book it', async ({
  page,
  request,
}) => {
  const reviewDate = addDays(istDate(new Date()), 10);
  // Hours that no 45 minute Review fits.
  const { patient, consultationId } = await signedPlanWith(
    [{ starts: 10 * 60, ends: 10 * 60 + 30 }],
    reviewDate,
  );
  const desk = await temporaryDesk();
  await signIn(page, desk.email);
  await activePlan(consultationId);
  const card = page.getByTestId('task-card').filter({ hasText: patient.name });
  await tickUntil(request, async () => {
    await page.goto('/app/tasks');
    await expect(card).toHaveCount(1, { timeout: 1000 });
  });
  await expect(card).toContainText('Book the 6 week review');
  await expect(card.getByTestId('review-to-book')).toContainText(/^Review due \d+ \w+ \d{4} with /);
  await expect(card.getByTestId('review-to-book')).toContainText('No free time found up to');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: test.info().outputPath('review-task.png'), fullPage: true });
});
