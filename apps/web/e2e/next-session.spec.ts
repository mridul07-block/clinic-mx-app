import { addDays, formatIstDateTime, istDate } from '@clinic-mx/schemas';
import { expect, test } from '@playwright/test';
import { completeVisit } from './bills';
import { physioAtHsr, removeCalendarRows, startedAppointment } from './calendar';
import { signedConsultation } from './consultations';
import { otherBrowser, removePipelineRows } from './intake';
import { consultationTypeId, submittedWithAlert } from './my-patients';
import { testPatient } from './patients';
import { activePlan } from './plan-sheet';
import { signInWithCode, temporaryWithCode } from './staff';

// SCH-12 done when: the physio books the patient's next session from the session screen, for their
// own patients. Decisions (user, 26 October 2026): with themselves; while writing and once signed,
// for the note's writer only; a date from the plan's frequency, then their free times; capped
// like Book plan sessions.

const physios: string[] = [];
const visits: string[] = [];
test.afterEach(async () => {
  await removePipelineRows(visits.splice(0));
  if (physios.length) await removeCalendarRows(physios.splice(0));
});

test('the physio writing the session books the next one into their own free time', async ({
  page,
  browser,
}) => {
  test.slow();
  const physio = await temporaryWithCode('physiotherapist', ['HSR Layout'], { consultant: true });
  physios.push(physio.id);
  await physioAtHsr(physio.id, { consultant: true, feeKey: 'consultation' });
  const patient = await testPatient();
  const consultationVisit = await startedAppointment(physio.id, patient.id, 120, {
    minutes: 45,
    values: {
      appointmentTypeId: await consultationTypeId(),
      status: 'checked_in',
      arrivedAt: new Date(),
      checkedInBy: physio.id,
    },
  });
  visits.push(consultationVisit.id);
  await submittedWithAlert(consultationVisit.id, patient.id);
  // The fixture's plan: 2 a week for 6 weeks, treated by this physio; paid, so Active.
  const { consultationId } = await signedConsultation(consultationVisit.id, physio.id);
  await completeVisit(consultationVisit.id);
  const episodeId = await activePlan(consultationId);
  const session = await startedAppointment(physio.id, patient.id, 30, {
    minutes: 45,
    values: {
      episodeId,
      status: 'in_progress',
      arrivedAt: new Date(),
      checkedInBy: physio.id,
      startedAt: new Date(),
      startedBy: physio.id,
    },
  });

  await signInWithCode(page, physio.email, physio.secret);
  await page.goto(`/app/sessions/${session.id}`);
  const panel = page.getByTestId('next-session');
  // 12 planned, this one in progress: 11 to book; the date is 4 days on (7 over 2, rounded).
  await expect(panel.getByTestId('next-session-left')).toHaveText('11 to book');
  const form = panel.getByTestId('next-session-form');
  await expect(form.getByLabel('Date')).toHaveValue(addDays(istDate(new Date()), 4));

  // Their free times that day (09:00 to 13:00); the first is booked with them.
  const tomorrow = addDays(istDate(new Date()), 1);
  await form.getByLabel('Date').fill(tomorrow);
  await form.getByRole('button', { name: 'Show times' }).click();
  const first = form.locator('label').filter({ hasText: '9:00 AM' });
  await expect(first).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: test.info().outputPath('next-session.png'), fullPage: true });
  await form.getByRole('button', { name: 'Book next session' }).click();
  await expect(form).toContainText('Pick a time.');
  await form.locator('label').filter({ hasText: '9:00 AM' }).click();
  await form.getByRole('button', { name: 'Book next session' }).click();
  await expect(panel.getByTestId('next-session-booked')).toContainText(
    /^Booked \w{3} .*, 9:00 AM · /,
  );
  await expect(panel.getByTestId('next-session-left')).toHaveText('10 to book');
  await expect(page.getByTestId('summary-next-visit')).toContainText(
    formatIstDateTime(new Date(`${tomorrow}T03:30:00Z`)),
  );
  await page.screenshot({
    path: test.info().outputPath('next-session-booked.png'),
    fullPage: true,
  });

  // A colleague at the centre reads the session, with no panel.
  const colleague = await temporaryWithCode('physiotherapist', ['HSR Layout']);
  physios.push(colleague.id);
  const other = await otherBrowser(browser);
  await signInWithCode(other, colleague.email, colleague.secret);
  await other.goto(`/app/sessions/${session.id}`);
  await expect(other.getByTestId('session-read-only')).toBeVisible();
  await expect(other.getByTestId('next-session')).toHaveCount(0);
  await other.context().close();
});
