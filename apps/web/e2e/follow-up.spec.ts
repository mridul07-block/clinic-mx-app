import { createDb, episode, followUpSchedule, systemActor, task, withActor } from '@clinic-mx/db';
import { expect, test } from '@playwright/test';
import { and, eq, sql } from 'drizzle-orm';
import { removeCalendarRows, startedAppointment } from './calendar';
import { signedConsultation } from './consultations';
import { removePipelineRows } from './intake';
import { consultationTypeId, submittedWithAlert } from './my-patients';
import { moveEpisode, testPatient } from './patients';
import { activePlan } from './plan-sheet';
import { signIn, temporaryDesk, temporaryWithCode } from './staff';

// PAT-10 done when: 2 weeks, 6 weeks, 3 months, 12 months; "Injured again" logs a recurrence and
// alerts the consultant. Recommended defaults (29 October 2026): until WhatsApp, the desk shows the
// follow up due as a QR; one tap answers it; Injured again gives the consultant who discharged a
// high task. The discharge is moved back 20 days so the 2 week follow up is due.

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

test('the patient answers the due follow up from the desk’s QR; Injured again alerts the consultant', async ({
  page,
  browser,
}) => {
  test.slow();
  const physio = await temporaryWithCode('physiotherapist', ['HSR Layout'], { consultant: true });
  physios.push(physio.id);
  const patient = await testPatient();
  const seen = await startedAppointment(physio.id, patient.id, 60, {
    minutes: 45,
    values: {
      appointmentTypeId: await consultationTypeId(),
      status: 'completed',
      completedAt: new Date(),
    },
  });
  visits.push(seen.id);
  await submittedWithAlert(seen.id, patient.id);
  const { consultationId } = await signedConsultation(seen.id, physio.id);
  const episodeId = await activePlan(consultationId);
  await moveEpisode(episodeId, 'active', ['discharged'], 'goals_achieved');

  // Just discharged: nothing due yet, the 2 week follow up is next.
  const desk = await temporaryDesk();
  await signIn(page, desk.email);
  await page.goto(`/app/plans/${episodeId}`);
  const section = page.getByTestId('follow-up-qr');
  await expect(section.getByTestId('follow-up-next')).toContainText('The next follow up is due on');

  await withActor(db(), systemActor('tests'), async (tx) => {
    await tx.execute(sql`set local session_replication_role = replica`);
    await tx
      .update(episode)
      .set({ closedAt: sql`now() - interval '20 days'` })
      .where(eq(episode.id, episodeId));
    await tx
      .update(followUpSchedule)
      .set({ dueOn: sql`${followUpSchedule.dueOn} - 20` })
      .where(eq(followUpSchedule.episodeId, episodeId));
  });
  await page.reload();
  await section.getByRole('button', { name: 'Show follow up QR' }).click();
  await expect(section.getByRole('img', { name: /QR code for the patient/ })).toBeVisible();
  const path = (await section.getByTestId('follow-up-path').textContent())?.trim() ?? '';
  expect(path).toMatch(/^\/p\/[^/]+$/);

  // The patient's phone, signed out: the PRD's three answers, one tap.
  const phone = await browser.newContext(test.info().project.use);
  const mine = await phone.newPage();
  await mine.goto(path);
  const form = mine.getByTestId('follow-up-form');
  await expect(form.getByTestId('follow-up-period')).toHaveText(
    '2 weeks after your treatment ended',
  );
  await expect(form.getByRole('button')).toHaveText(['Doing well', 'Some pain', 'Injured again']);
  expect(await mine.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await mine.screenshot({ path: test.info().outputPath('follow-up.png'), fullPage: true });
  await form.getByRole('button', { name: 'Injured again' }).click();
  await expect(mine.getByTestId('patient-link-status')).toHaveText(
    'Thank you. Your feedback has reached the clinic.',
  );
  await mine.reload();
  await expect(mine.getByTestId('follow-up-form')).toHaveCount(0);
  await phone.close();

  // The desk now sees the next follow up; the consultant who discharged has the high task.
  await page.reload();
  await expect(section.getByTestId('follow-up-next')).toContainText('The next follow up is due on');
  const [closed] = await db()
    .select({ by: episode.dischargedBy })
    .from(episode)
    .where(eq(episode.id, episodeId));
  const tasks = await db()
    .select({ assignee: task.assigneeStaffUserId, priority: task.priority, title: task.title })
    .from(task)
    .where(and(eq(task.kind, 'review.injured_again'), eq(task.episodeId, episodeId)));
  expect(tasks).toEqual([
    { assignee: closed?.by ?? '', priority: 'high', title: 'Injured again after discharge' },
  ]);
  await withActor(db(), systemActor('tests'), (tx) =>
    tx
      .delete(task)
      .where(and(eq(task.kind, 'review.injured_again'), eq(task.episodeId, episodeId))),
  );
});
