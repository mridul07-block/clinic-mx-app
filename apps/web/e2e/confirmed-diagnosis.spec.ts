import {
  confirmedDiagnosis,
  createDb,
  systemActor,
  updateEpisodeState,
  withActor,
} from '@clinic-mx/db';
import { expect, test, type Page } from '@playwright/test';
import { asc, eq } from 'drizzle-orm';
import { completeVisit } from './bills';
import { removeCalendarRows, startedAppointment } from './calendar';
import { signedConsultation } from './consultations';
import { removePipelineRows } from './intake';
import { consultationTypeId, submittedWithAlert } from './my-patients';
import { testPatient } from './patients';
import { activePlan } from './plan-sheet';
import { signInWithCode, temporaryWithCode } from './staff';

// AI-05: the diagnosis confirmed at review or discharge (PRD section 6: the learning label, "not
// the first impression"). Recommended defaults (29 October 2026): a consultant confirms the signed
// diagnosis, or changes it within its knowledge base version, on the Review and discharge screen;
// never edited, a later confirmation is the label; others read it.

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

const fits = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

test('a consultant confirms the signed diagnosis, then changes it; a physio reads it', async ({
  page,
  browser,
}) => {
  const consultant = await temporaryWithCode('physiotherapist', ['HSR Layout'], {
    consultant: true,
  });
  physios.push(consultant.id);
  const physio = await temporaryWithCode('physiotherapist', ['HSR Layout']);
  physios.push(physio.id);
  const patient = await testPatient();
  const visit = await startedAppointment(consultant.id, patient.id, 200, {
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
  const { consultationId, conditionName } = await signedConsultation(visit.id, consultant.id, {
    sections: { objective: { region: 'knee', side: 'right' } },
  });
  await completeVisit(visit.id);
  const episodeId = await activePlan(consultationId);

  await signInWithCode(page, consultant.email, consultant.secret);
  await page.goto(`/app/episodes/${episodeId}/review`);
  const panel = page.getByTestId('confirm-diagnosis');
  // Never the first impression: nothing to confirm before the episode is reviewed.
  await expect(panel.getByTestId('confirm-waits')).toContainText(
    'A diagnosis is confirmed at review or discharge',
  );
  await expect(panel.getByRole('button', { name: 'Confirm diagnosis' })).toHaveCount(0);
  await withActor(db(), systemActor('tests'), (tx) =>
    updateEpisodeState(tx, episodeId, 'active', { status: 'under_review', pausedFrom: null }),
  );
  await page.reload();
  await expect(panel.getByTestId('signed-diagnosis')).toHaveText(
    `Diagnosis at the consultation: ${conditionName}`,
  );
  await expect(panel).toContainText('Not confirmed yet.');
  await expect(panel.getByTestId('chosen-condition')).toContainText(conditionName);
  await panel.getByRole('button', { name: 'Confirm diagnosis' }).click();
  const record = panel.getByTestId('confirmed-diagnosis-record');
  await expect(record).toContainText(conditionName);
  await expect(record).toContainText('Confirmed diagnosis');
  await expect(record).toContainText(/At review · /);
  await expect(record).not.toContainText('changed');

  // Changed at review: the later confirmation is the label.
  await panel.getByRole('button', { name: 'Change' }).click();
  // Enter on a search with no match never confirms anything.
  await panel.getByRole('combobox', { name: 'Diagnosis to confirm' }).fill('xyzzy');
  await panel.getByRole('combobox', { name: 'Diagnosis to confirm' }).press('Enter');
  await expect(panel).toContainText('A confirmed diagnosis is a knowledge base condition.');
  await panel.getByRole('combobox', { name: 'Diagnosis to confirm' }).fill('patellar tend');
  await panel.getByRole('combobox', { name: 'Diagnosis to confirm' }).press('Enter');
  await expect(panel.getByTestId('chosen-condition')).toContainText('Patellar Tendinopathy');
  await panel.getByRole('button', { name: 'Confirm diagnosis' }).click();
  await expect(record).toContainText('Patellar Tendinopathy');
  await expect(record).toContainText('At review, changed from the consultation');
  expect(await fits(page)).toBe(true);
  await page.screenshot({
    path: test.info().outputPath('confirmed-diagnosis.png'),
    fullPage: true,
  });
  const rows = await db()
    .select({ stage: confirmedDiagnosis.stage, by: confirmedDiagnosis.confirmedBy })
    .from(confirmedDiagnosis)
    .where(eq(confirmedDiagnosis.episodeId, episodeId))
    .orderBy(asc(confirmedDiagnosis.confirmedAt));
  expect(rows).toEqual([
    { stage: 'review', by: consultant.id },
    { stage: 'review', by: consultant.id },
  ]);

  // A physio without the Consultant tick reads it, and confirms nothing.
  const otherPage = await (await browser.newContext()).newPage();
  await signInWithCode(otherPage, physio.email, physio.secret);
  await otherPage.goto(`/app/episodes/${episodeId}/review`);
  const read = otherPage.getByTestId('confirm-diagnosis');
  await expect(read.getByTestId('confirmed-diagnosis-record')).toContainText(
    'Patellar Tendinopathy',
  );
  await expect(read.getByRole('button', { name: 'Confirm diagnosis' })).toHaveCount(0);
  await otherPage.context().close();
});
