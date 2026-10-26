import { expect, test, type Locator } from '@playwright/test';
import { completeVisit } from './bills';
import { removeCalendarRows, startedAppointment } from './calendar';
import { signedConsultation } from './consultations';
import { otherBrowser, removePipelineRows } from './intake';
import { consultationTypeId, submittedWithAlert } from './my-patients';
import { testPatient } from './patients';
import { activePlan } from './plan-sheet';
import { reassessmentTaskOf, signedSessionsWithBaseline } from './reassessment';
import { signInWithCode, temporaryWithCode } from './staff';

// OUT-05 done when: the treating physio records the markers at session 4 and the consultant
// reviews and signs the decision. Decisions (user, 26 October 2026; DECISION 7 default): session
// 4's physio measures exactly the baseline's measures, both sides of a side by side one, each
// recorded or Not tested with a reason before closing; the episode's consultant gets a task, sees
// baseline against session 4 with the change, and signs a written decision once.

const physios: string[] = [];
const visits: string[] = [];
test.afterEach(async () => {
  await removePipelineRows(visits.splice(0));
  if (physios.length) await removeCalendarRows(physios.splice(0));
});

test('session 4 retakes the baseline measures, and the consultant signs the decision from their task', async ({
  page,
  browser,
}) => {
  test.slow();
  const consultant = await temporaryWithCode('physiotherapist', ['HSR Layout'], {
    consultant: true,
  });
  const physio = await temporaryWithCode('physiotherapist', ['HSR Layout']);
  physios.push(consultant.id, physio.id);
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
  const { consultationId } = await signedConsultation(consultationVisit.id, consultant.id);
  await completeVisit(consultationVisit.id);
  const episodeId = await activePlan(consultationId);
  await signedSessionsWithBaseline({
    physioId: physio.id,
    patientId: patient.id,
    episodeId,
    consultationId,
  });
  const fourth = await startedAppointment(physio.id, patient.id, 30, {
    minutes: 45,
    values: { episodeId, status: 'checked_in', arrivedAt: new Date(), checkedInBy: physio.id },
  });

  // Session 4: the physio retakes the baseline's measures.
  await signInWithCode(page, physio.email, physio.secret);
  await page.goto('/app/my-patients');
  await page
    .locator(`[data-testid="my-patient"][data-appointment="${fourth.id}"]`)
    .getByRole('button', { name: `Start session for ${patient.name}` })
    .click();
  await page.waitForURL((url) => url.pathname === `/app/sessions/${fourth.id}`);
  await expect(page.getByTestId('session-label')).toContainText('Session 4');
  const note = page.getByRole('region', { name: 'Session note' });
  const item = (name: string) => note.getByTestId('reassessment-item').filter({ hasText: name });
  await expect(note.getByTestId('reassessment-item')).toHaveCount(3);
  await expect(item('Quadriceps')).toContainText(
    'Baseline: Involved 32 kg, uninvolved 40 kg · LSI 80% · Not yet',
  );
  await expect(item('Primary task pain (NRS 0-10)')).toContainText('Baseline: 6/10');
  await expect(item('Effusion grade (0-3)')).toContainText(
    'Baseline: Not tested (Swelling not assessable)',
  );
  const blockers = note.getByTestId('close-blockers');
  await expect(blockers).toContainText(
    'Record both sides of Quadriceps, or mark it Not tested with a reason.',
  );

  await note.locator('label').filter({ hasText: /^No$/ }).click();
  await note.getByLabel('Pain at rest').fill('2');
  await note.getByLabel('Pain during activity').fill('3');
  await note.getByLabel('Pain after treatment').fill('1');
  await note.getByRole('checkbox', { name: 'Exercise' }).check();
  await note
    .locator('label')
    .filter({ hasText: /^Better$/ })
    .click();
  await note
    .locator('label')
    .filter({ hasText: /^Progress$/ })
    .click();
  await item('Quadriceps').getByLabel('Quadriceps involved').fill('36');
  await expect(blockers).toContainText('Record both sides of Quadriceps');
  await item('Quadriceps').getByLabel('Quadriceps uninvolved').fill('39');
  await expect(item('Quadriceps').getByTestId('reassessment-live-change')).toHaveText(
    'LSI 80% → 92%',
  );
  await item('Primary task pain (NRS 0-10)').getByLabel('Primary task pain (NRS 0-10)').fill('3');
  const grade = (row: Locator, value: string) => row.getByText(value, { exact: true }).click();
  await grade(item('Effusion grade (0-3)'), '1');
  await expect(blockers).toHaveCount(0);
  await expect(note.getByRole('status')).toHaveText('Saved');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: test.info().outputPath('reassessment-note.png'), fullPage: true });
  await note.getByRole('button', { name: 'Close session' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Session closed.' })).toBeVisible();
  expect(await reassessmentTaskOf(episodeId)).toEqual({ status: 'open', decision: null });

  // The consultant's task opens the review: baseline against session 4, then the decision.
  const reviewer = await otherBrowser(browser);
  await signInWithCode(reviewer, consultant.email, consultant.secret);
  await reviewer.goto('/app/tasks');
  const card = reviewer
    .getByTestId('task-card')
    .filter({ hasText: 'Review the session 4 reassessment' })
    .filter({ hasText: patient.name });
  await card.getByRole('link', { name: 'Open the reassessment' }).click();
  await expect(reviewer.getByRole('heading', { name: 'Session 4 reassessment' })).toBeVisible();
  await expect(reviewer.getByTestId('reassessment-status')).toHaveText('Awaiting review');
  const row = (name: string) => reviewer.getByTestId('reassessment-row').filter({ hasText: name });
  await expect(row('Quadriceps').getByTestId('reassessment-change')).toHaveText('LSI 80% → 92%');
  await expect(row('Primary task pain (NRS 0-10)').getByTestId('reassessment-change')).toHaveText(
    '6/10 → 3/10',
  );
  await expect(row('Effusion grade (0-3)')).toContainText('Not tested: Swelling not assessable');
  const form = reviewer.getByTestId('reassessment-decision-form');
  await form.getByRole('button', { name: 'Sign decision' }).click();
  await expect(form.getByLabel('Decision')).toBeFocused();
  await form
    .getByLabel('Decision')
    .fill('Strength and pain on track. Continue the plan; recheck effusion next session.');
  expect(
    await reviewer.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBe(true);
  await reviewer.screenshot({
    path: test.info().outputPath('reassessment-review.png'),
    fullPage: true,
  });
  await form.getByRole('button', { name: 'Sign decision' }).click();
  await expect(reviewer.getByTestId('reassessment-status')).toHaveText('Signed');
  await expect(reviewer.getByTestId('reassessment-signed')).toContainText(
    `Signed by ${consultant.name}`,
  );
  await expect(form).toHaveCount(0);
  expect(await reassessmentTaskOf(episodeId)).toEqual({
    status: 'closed',
    decision: 'Strength and pain on track. Continue the plan; recheck effusion next session.',
  });

  // The physio's signed note shows the same, reviewed.
  await page.goto(`/app/sessions/${fourth.id}`);
  await expect(note.getByTestId('reassessment-review')).toContainText(
    `Reviewed by ${consultant.name}`,
  );
  await expect(note.getByTestId('reassessment-change').first()).toHaveText('LSI 80% → 92%');
  await reviewer.context().close();
});
