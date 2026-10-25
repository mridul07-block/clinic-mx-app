import { addDays, documentDate, istDate, istInstant } from '@clinic-mx/schemas';
import { expect, test } from '@playwright/test';
import { centreIdByCode, removeCalendarRows, startedAppointment } from './calendar';
import { signedConsultation } from './consultations';
import { removePipelineRows } from './intake';
import { runDueJobs } from './jobs';
import { consultationTypeId, submittedWithAlert } from './my-patients';
import { testPatient } from './patients';
import { proposedPlan, testPackage, thinkAboutItDueNow } from './plan-sheet';
import { restorePrices, snapshotPrices } from './prices';
import { exclusively, signIn, signInWithCode, temporaryDesk, temporaryWithCode } from './staff';

// BIL-02 done when: the patient's choice is stored against the plan, with a nudge after 2 days
// plus a call task. Decisions (user, 25 October 2026): no expiry until the client says (decision
// 14); the follow up at 10:00 AM IST on the second day; "No thanks" is recorded only; a package
// or session type is named, and every choice is kept with the newest counting.

const physios: string[] = [];
const visits: string[] = [];
test.afterEach(async () => {
  await removePipelineRows(visits.splice(0));
  if (physios.length) await removeCalendarRows(physios.splice(0));
});

test('the desk records the choice, and "I’ll think about it" is followed up', async ({
  page,
  browser,
}) => {
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
  test.skip(
    istDate(visit.startsAt) !== istDate(new Date()),
    'The visit falls on yesterday in IST.',
  );
  await submittedWithAlert(visit.id, patient.id);
  const { consultationId } = await signedConsultation(visit.id, physio.id);
  await proposedPlan(consultationId);

  const desk = await temporaryDesk();
  let href = '';
  await exclusively('e2e prices', async () => {
    const snapshot = await snapshotPrices();
    try {
      await testPackage({
        name: 'E2E Ten sessions',
        sessions: 10,
        pricePaise: 9_000_00,
        itemKey: 'rehabilitation_session',
      });
      await signIn(page, desk.email);
      await page.goto(`/app/today?centre=${await centreIdByCode('HSR')}`);
      await page.getByRole('link', { name: `Plan and payment for ${patient.name}` }).click();
      await expect(page.getByRole('heading', { name: 'Plan and payment' })).toBeVisible();
      href = new URL(page.url()).pathname;
      await expect(page.getByTestId('no-choice')).toBeVisible();

      // Nothing picked: refused, with nothing recorded.
      const form = page.getByTestId('plan-choice-form');
      await form.getByRole('button', { name: 'Record choice' }).click();
      await expect(form).toContainText('Choose what the patient decided.');

      // "I'll think about it": the follow up on the second day at 10:00 AM IST.
      await form.getByRole('radio', { name: /I’ll think about it/ }).check();
      await form.getByRole('button', { name: 'Record choice' }).click();
      const current = page.getByTestId('current-choice');
      await expect(current).toContainText('I’ll think about it');
      await expect(current).toContainText(`Recorded by ${desk.name}`);
      const followUp = istInstant(addDays(istDate(new Date()), 2), 10 * 60);
      await expect(page.getByTestId('follow-up')).toHaveText(
        `Follow-up call and WhatsApp nudge on ${documentDate(followUp)} at 10:00 AM`,
      );
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true);
      await page.screenshot({ path: test.info().outputPath('plan-choice.png'), fullPage: true });

      // Two days on: the desk's call task (the nudge is queued for the WhatsApp tickets).
      expect(await thinkAboutItDueNow(patient.id)).toBe(1);
      await runDueJobs(page.request);
      await page.goto('/app/tasks');
      const call = page
        .getByTestId('open-tasks')
        .getByTestId('task-card')
        .filter({ hasText: patient.name });
      await expect(call).toHaveCount(1);
      await expect(call).toContainText('Call about the proposed plan (thinking it over since');
      await expect(call).toContainText('Call about a proposed plan');

      // The patient comes back for the package: it counts now, the earlier choice is kept.
      await page.goto(href);
      await form.getByRole('radio', { name: /Package: E2E Ten sessions/ }).check();
      await form.getByRole('button', { name: 'Record choice' }).click();
      await expect(current).toContainText('Package: E2E Ten sessions');
      await expect(page.getByTestId('follow-up')).toHaveCount(0);
      await page.getByText('Earlier choices (1)').click();
      await expect(page.getByTestId('earlier-choices')).toContainText('I’ll think about it');
    } finally {
      await restorePrices(snapshot);
    }
  });

  // "No thanks" is recorded only: the episode stays Plan proposed.
  await page.goto(href);
  const form = page.getByTestId('plan-choice-form');
  await form.getByRole('radio', { name: /No thanks/ }).check();
  await form.getByRole('button', { name: 'Record choice' }).click();
  await expect(page.getByTestId('current-choice')).toContainText(
    'The plan and all clinical information stay on the record.',
  );
  await expect(page.locator('main')).toContainText('Plan proposed');

  // A physio is refused; the desk at another centre has no plan to record a choice on.
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
  await expect(desk2.getByTestId('no-plan')).toBeVisible();
  await expect(desk2.getByTestId('plan-choice-form')).toHaveCount(0);
  await elsewhere.close();
});
