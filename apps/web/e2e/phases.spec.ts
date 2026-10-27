import { expect, test } from '@playwright/test';
import { completeVisit } from './bills';
import { removeCalendarRows, startedAppointment } from './calendar';
import { signedConsultation } from './consultations';
import { removePipelineRows } from './intake';
import { consultationTypeId, submittedWithAlert } from './my-patients';
import { testPatient } from './patients';
import { activePlan, treatedBy } from './plan-sheet';
import { signInWithCode, temporaryWithCode } from './staff';

// OUT-04 done when: locked phases show unmet criteria in words; the treating physio progresses
// when met; a consultant overrides with a reason. Decisions (user, 27 October 2026): each exit
// line marked Met or Not yet by the treating physio; Phase 0 first; a consultant moves to any
// phase with a reason; the acceptable pain setting beside a pain line (DECISION #4).

const physios: string[] = [];
const visits: string[] = [];
test.afterEach(async () => {
  await removePipelineRows(visits.splice(0));
  if (physios.length) await removeCalendarRows(physios.splice(0));
});

test('the treating physio moves a knee patient on once Phase 0 is met; a consultant overrides', async ({
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
  const { consultationId } = await signedConsultation(consultationVisit.id, consultant.id, {
    sections: { objective: { region: 'knee', side: 'right' } },
  });
  await completeVisit(consultationVisit.id);
  const episodeId = await activePlan(consultationId);
  await treatedBy(episodeId, physio.id);

  await signInWithCode(page, physio.email, physio.secret);
  await page.goto(`/app/patients/${patient.id}?tab=progress`);
  const stepper = page.getByTestId('phase-stepper');
  const step = (n: number) =>
    stepper.locator(`[data-testid="phase-step"][data-phase="${String(n)}"]`);
  await expect(step(0)).toHaveAttribute('data-state', 'current');
  await expect(step(1).getByTestId('phase-locked')).toContainText('Phase 0: Effusion controlled');
  await expect(step(2).getByTestId('phase-locked')).toContainText('Phase 1 comes first.');
  const move = stepper.getByTestId('phase-progress');
  await expect(move.getByRole('button', { name: 'Move to Phase 1' })).toBeDisabled();
  await expect(move).toContainText('Mark every exit criterion of this phase Met first.');
  await expect(stepper.getByTestId('phase-override')).toHaveCount(0);

  const lines = step(0).getByTestId('phase-line');
  await expect(lines).toHaveCount(3);
  for (let i = 0; i < 3; i++) {
    await lines.nth(i).getByRole('button', { name: 'Met' }).click();
    await expect(lines.nth(i).getByRole('button', { name: 'Met' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  }
  await expect(step(1).getByTestId('phase-locked')).toContainText(
    'Every exit criterion of Phase 0 is Met: ready to move on.',
  );
  await move.getByRole('button', { name: 'Move to Phase 1' }).click();
  await expect(step(1)).toHaveAttribute('data-state', 'current');
  await expect(step(0)).toHaveAttribute('data-state', 'done');
  // Phase 1's pain line carries the acceptable pain setting (DECISION #4).
  await expect(step(1).getByTestId('phase-pain-hint')).toContainText(
    'Acceptable exercise pain is up to 5/10 (clinic setting).',
  );
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: test.info().outputPath('phase-stepper.png'), fullPage: true });

  // The consultant overrides to Phase 3 with a reason.
  const lead = await browser.newContext(test.info().project.use);
  const leadPage = await lead.newPage();
  await signInWithCode(leadPage, consultant.email, consultant.secret);
  await leadPage.goto(`/app/patients/${patient.id}?tab=progress`);
  const override = leadPage.getByTestId('phase-override');
  await override.getByText('Move to another phase (consultant override)').click();
  await override.getByLabel('Phase').selectOption({ label: 'Phase 3: Energy Storage & Power' });
  await override.getByLabel('Reason').fill('Returned after surgery elsewhere; hop testing done.');
  await override.getByRole('button', { name: 'Move phase' }).click();
  const leadStepper = leadPage.getByTestId('phase-stepper');
  await expect(leadStepper.locator('[data-testid="phase-step"][data-phase="3"]')).toHaveAttribute(
    'data-state',
    'current',
  );
  await expect(leadStepper.locator('[data-testid="phase-step"][data-phase="2"]')).toHaveAttribute(
    'data-state',
    'skipped',
  );
  await leadStepper.getByText('Phase history').click();
  await expect(leadStepper.getByTestId('phase-history')).toContainText(
    'Override from Phase 1 to Phase 3: Returned after surgery elsewhere; hop testing done.',
  );
  await expect(leadStepper.getByTestId('phase-history')).toContainText(
    'Moved on from Phase 0 to Phase 1',
  );
  await leadPage.screenshot({
    path: test.info().outputPath('phase-override.png'),
    fullPage: true,
  });
  await lead.close();

  // The session screen's summary card reads the phase.
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
  visits.push(session.id);
  await page.goto(`/app/sessions/${session.id}`);
  await expect(page.getByTestId('summary-card').getByTestId('summary-phase')).toHaveText(
    'Phase 3 of 4: Energy Storage & Power',
  );
});
