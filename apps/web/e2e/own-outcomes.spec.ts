import { expect, test } from '@playwright/test';
import { completeVisit } from './bills';
import { removeCalendarRows, startedAppointment } from './calendar';
import { signedConsultation } from './consultations';
import { consultationTypeId } from './my-patients';
import { moveEpisode, testEpisode, testPatient } from './patients';
import { signIn, signInWithCode, temporaryDesk, temporaryWithCode } from './staff';

// DSH-06 done when: my patients' outcomes and adherence. Recommended defaults chosen under the
// user's standing approval, 28 October 2026: a treating physio opens "My patients' outcomes" from
// My patients and sees the Centre Manager's outcome figures over the episodes whose plan names
// them, against the clinic's targets, with no colleague's figures; adherence and meaningful change
// say what will bring them. Others are not let in.

const physios: string[] = [];
test.afterEach(async () => {
  if (physios.length) await removeCalendarRows(physios.splice(0));
});

test('a treating physio sees their own patients’ outcomes against the clinic’s targets', async ({
  page,
}) => {
  const physio = await temporaryWithCode('physiotherapist', ['HSR Layout'], { consultant: true });
  physios.push(physio.id);
  // One episode they consulted, treated and discharged with the goals met.
  const patient = await testPatient();
  const episodeId = await testEpisode(patient.id, 'awaiting_consultation');
  const visit = await startedAppointment(physio.id, patient.id, 120, {
    minutes: 45,
    values: {
      appointmentTypeId: await consultationTypeId(),
      episodeId,
      status: 'checked_in',
      arrivedAt: new Date(),
      checkedInBy: physio.id,
    },
  });
  const { conditionName } = await signedConsultation(visit.id, physio.id);
  await completeVisit(visit.id);
  await moveEpisode(episodeId, 'awaiting_consultation', ['plan_proposed', 'active', 'discharged']);

  await signInWithCode(page, physio.email, physio.secret);
  await page.goto('/app/my-patients');
  await page.getByTestId('my-outcomes-link').click();
  await expect(page.getByRole('heading', { name: 'My patients’ outcomes' })).toBeVisible();
  await page.getByRole('link', { name: 'Last 12 months' }).click();
  await expect(page.getByRole('link', { name: 'Last 12 months' })).toHaveAttribute(
    'aria-current',
    'page',
  );

  await expect(page.getByTestId('outcome-bullet')).toHaveCount(4);
  const completion = page.locator('[data-figure="treatment_completion"]');
  await expect(completion).toContainText('1 of 1');
  await expect(completion).toContainText('100%');
  await expect(page.locator('[data-figure="consultation_conversion"]')).toContainText('1 of 1');
  await expect(page.locator('[data-figure="meaningful_change"]')).toContainText('Not measured yet');
  await expect(page.getByTestId('own-coming')).toContainText('PAT-02');
  await expect(page.getByTestId('funnel-stage')).toHaveCount(5);
  await expect(page.getByText(conditionName).first()).toBeVisible();
  await expect(page.locator('body')).not.toContainText('₹');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: test.info().outputPath('own-outcomes.png'), fullPage: true });
});

test('the desk, Finance and a Centre Manager are not let in', async ({ browser }) => {
  const desk = await temporaryDesk();
  const finance = await temporaryWithCode('finance');
  const manager = await temporaryWithCode('centre_manager', ['HSR Layout']);
  for (const signInAs of [
    (p: Parameters<typeof signIn>[0]) => signIn(p, desk.email),
    (p: Parameters<typeof signIn>[0]) => signInWithCode(p, finance.email, finance.secret),
    (p: Parameters<typeof signIn>[0]) => signInWithCode(p, manager.email, manager.secret),
  ]) {
    const context = await browser.newContext(test.info().project.use);
    const page = await context.newPage();
    await signInAs(page);
    await page.goto('/app/my-patients/outcomes');
    await expect(page).toHaveURL(/\/app\/not-allowed/);
    await context.close();
  }
});
