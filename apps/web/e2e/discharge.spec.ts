import { appointment, createDb, episode } from '@clinic-mx/db';
import { expect, test, type Page } from '@playwright/test';
import { eq } from 'drizzle-orm';
import { completeVisit } from './bills';
import { removeCalendarRows, startedAppointment } from './calendar';
import { signedConsultation } from './consultations';
import { removePipelineRows } from './intake';
import { consultationTypeId, submittedWithAlert } from './my-patients';
import { testEpisode, testPatient } from './patients';
import { activePlan } from './plan-sheet';
import { signInWithCode, temporaryWithCode } from './staff';

// OUT-10 done when: a mandatory reason from the list; non attendance never counted as recovered.
// Decisions (user, 27 October 2026): a consultant discharges any episode not yet discharged on
// the Review and discharge screen; a recovered reason only after treatment; discharging cancels
// the visits booked ahead, listed first.

let database: ReturnType<typeof createDb> | undefined;
const db = () => {
  const url = process.env.DIRECT_DATABASE_URL;
  if (!url) throw new Error('DIRECT_DATABASE_URL is not set.');
  database ??= createDb(url, { max: 1 });
  return database.db;
};
test.afterAll(async () => {
  await database?.close();
});

const physios: string[] = [];
const visits: string[] = [];
test.afterEach(async () => {
  await removePipelineRows(visits.splice(0));
  if (physios.length) await removeCalendarRows(physios.splice(0));
});

const DAY_MINUTES = 24 * 60;
const fits = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

test('a consultant discharges a treated episode as Goals achieved, cancelling the visit booked ahead', async ({
  page,
}) => {
  test.slow();
  const consultant = await temporaryWithCode('physiotherapist', ['HSR Layout'], {
    consultant: true,
  });
  physios.push(consultant.id);
  const patient = await testPatient();
  const consultationVisit = await startedAppointment(consultant.id, patient.id, 200, {
    minutes: 45,
    values: {
      appointmentTypeId: await consultationTypeId(),
      status: 'checked_in',
      arrivedAt: new Date(),
      checkedInBy: consultant.id,
    },
  });
  visits.push(consultationVisit.id);
  await submittedWithAlert(consultationVisit.id, patient.id);
  const { consultationId } = await signedConsultation(consultationVisit.id, consultant.id, {
    sections: { objective: { region: 'knee', side: 'right' } },
  });
  await completeVisit(consultationVisit.id);
  const episodeId = await activePlan(consultationId);
  const ahead = await startedAppointment(consultant.id, patient.id, -7 * DAY_MINUTES, {
    exact: true,
    values: { episodeId },
  });

  await signInWithCode(page, consultant.email, consultant.secret);
  await page.goto(`/app/episodes/${episodeId}/review`);
  const section = page.getByTestId('discharge');
  const reason = (label: string) =>
    section.getByTestId('discharge-reason').filter({ hasText: label }).getByRole('radio');
  await expect(section.getByTestId('discharge-reason')).toHaveCount(7);
  await expect(reason('Goals achieved')).toBeEnabled();
  await expect(section.getByTestId('discharge-cancels')).toContainText(
    'Discharging cancels 1 booked visit:',
  );
  await expect(section.getByTestId('discharge-cancels')).toContainText(ahead.number);
  expect(await fits(page)).toBe(true);
  await page.screenshot({ path: test.info().outputPath('discharge-form.png'), fullPage: true });

  await reason('Goals achieved').check();
  await section.getByRole('button', { name: 'Discharge' }).click();
  await expect(section.getByTestId('discharged')).toContainText(
    `Discharged by ${consultant.name} on`,
  );
  await expect(page.getByText(`Goals achieved · discharged by ${consultant.name}`)).toBeVisible();
  await expect(section.getByRole('button', { name: 'Discharge' })).toHaveCount(0);
  expect(await fits(page)).toBe(true);
  await page.screenshot({ path: test.info().outputPath('discharged.png'), fullPage: true });

  const [closed] = await db()
    .select({ status: episode.status, by: episode.dischargedBy })
    .from(episode)
    .where(eq(episode.id, episodeId));
  expect(closed).toEqual({ status: 'discharged', by: consultant.id });
  const [cancelled] = await db()
    .select({ status: appointment.status, reason: appointment.changeReason })
    .from(appointment)
    .where(eq(appointment.id, ahead.id));
  expect(cancelled).toEqual({ status: 'cancelled', reason: 'clinic' });
});

test('an untreated episode is never discharged as recovered; Other needs a note', async ({
  page,
}) => {
  const consultant = await temporaryWithCode('physiotherapist', ['HSR Layout'], {
    consultant: true,
  });
  physios.push(consultant.id);
  const patient = await testPatient();
  const episodeId = await testEpisode(patient.id, 'plan_proposed');

  await signInWithCode(page, consultant.email, consultant.secret);
  await page.goto(`/app/episodes/${episodeId}/review`);
  const section = page.getByTestId('discharge');
  const row = (label: string) => section.getByTestId('discharge-reason').filter({ hasText: label });
  await expect(row('Goals achieved').getByRole('radio')).toBeDisabled();
  await expect(row('Goals achieved')).toContainText(
    'Goals achieved needs treatment first: the episode was Plan proposed. Non attendance is never counted as recovered.',
  );
  await expect(row('Independent management').getByRole('radio')).toBeDisabled();
  await expect(section.getByTestId('discharge-cancels')).toHaveCount(0);

  // Other asks why, and the form will not post without it.
  await row('Other').getByRole('radio').check();
  const why = section.getByLabel('Why the episode is discharged');
  await expect(why).toHaveAttribute('required', '');
  await section.getByRole('button', { name: 'Discharge' }).click();
  await expect(section.getByTestId('discharged')).toHaveCount(0);
  expect(await fits(page)).toBe(true);

  await row('Patient choice').getByRole('radio').check();
  await section.getByRole('button', { name: 'Discharge' }).click();
  await expect(section.getByTestId('discharged')).toContainText(`Discharged by ${consultant.name}`);
  await expect(page.getByText(`Patient choice · discharged by ${consultant.name}`)).toBeVisible();
});
