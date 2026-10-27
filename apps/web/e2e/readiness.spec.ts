import { expect, test } from '@playwright/test';
import { completeVisit } from './bills';
import { removeCalendarRows, startedAppointment } from './calendar';
import { consultationMeasures, signedConsultation } from './consultations';
import { removePipelineRows } from './intake';
import { consultationTypeId, submittedWithAlert } from './my-patients';
import { testPatient } from './patients';
import { activePlan } from './plan-sheet';
import { signInWithCode, temporaryWithCode } from './staff';

// OUT-08 done when: Met, Not met, Not assessed per criterion; clearance disabled while anything is
// Not assessed; three statuses; override with reason. Decisions (user, 27 October 2026): the knee
// workbook's readiness lines, measured ones judged from the newest reading (recorded on the panel
// when never measured), yes or no ones marked by the consultant; the same criteria gate the three
// statuses, signed in order; an override with a written reason covers Not met and Not assessed.

const physios: string[] = [];
const visits: string[] = [];
test.afterEach(async () => {
  await removePipelineRows(visits.splice(0));
  if (physios.length) await removeCalendarRows(physios.splice(0));
});

const lsi = (name: string, involved: number, uninvolved: number, unit: string) => [
  { key: `knee.lsi.${name}`, limb: 'involved' as const, value: involved, unit },
  { key: `knee.lsi.${name}`, limb: 'uninvolved' as const, value: uninvolved, unit },
];
const VALGUS = 'knee.readiness.no_dynamic_valgus_on_single_leg_tasks_and_landing'; // gitleaks:allow
const SPORT = 'knee.readiness.sport_specific_progression_completed'; // gitleaks:allow
const MIND = 'knee.readiness.psychological_readiness_demonstrated_e_g_acl_rsi'; // gitleaks:allow
const LOAD = 'knee.readiness.graded_return_plan_with_load_monitoring_in_place'; // gitleaks:allow
const HAMSTRINGS = 'knee.lsi.hamstrings'; // gitleaks:allow

test('the readiness panel judges each criterion, and the three clearances are signed in order', async ({
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
  // Every measure but the hamstrings taken, each at or above 90%.
  await consultationMeasures(consultationId, 1, [
    ...lsi('quadriceps', 38, 40, 'kg'),
    ...lsi('hip_abductors', 37, 40, 'kg'),
    ...lsi('hip_external_rotators', 37, 40, 'kg'),
    ...lsi('calf_heel_raise_reps', 28, 30, 'reps'),
    ...lsi('single_hop_for_distance', 150, 160, 'cm'),
    ...lsi('triple_hop_for_distance', 430, 450, 'cm'),
    ...lsi('crossover_hop_for_distance', 300, 320, 'cm'),
    ...lsi('6_m_timed_hop', 2.2, 2, 'sec'),
  ]);

  await signInWithCode(page, consultant.email, consultant.secret);
  await page.goto(`/app/episodes/${episodeId}/review`);
  const panel = page.getByTestId('readiness');
  const row = (key: string) =>
    panel.locator(`[data-testid="readiness-row"][data-criterion="${key}"]`);
  const stateOf = (key: string) => row(key).getByTestId('readiness-state');
  await expect(panel.getByTestId('readiness-row')).toHaveCount(13);
  await expect(stateOf('knee.lsi.quadriceps')).toHaveText('Met'); // gitleaks:allow
  await expect(row('knee.lsi.quadriceps')).toContainText('LSI 95% · Pass (consultation'); // gitleaks:allow
  await expect(stateOf(HAMSTRINGS)).toHaveText('Not assessed');
  await expect(row(HAMSTRINGS)).toContainText('Not measured in this episode.');
  const clearance = (status: string) =>
    page.locator(`[data-testid="clearance"][data-status="${status}"]`);
  await expect(clearance('rehabilitation_complete').getByTestId('clearance-blocked')).toHaveText(
    '5 tests not assessed. Record them or add an override reason.',
  );
  await expect(
    clearance('rehabilitation_complete').getByRole('button', {
      name: 'Sign Rehabilitation complete',
    }),
  ).toBeDisabled();
  await expect(clearance('return_to_sport').getByTestId('clearance-blocked')).toHaveText(
    'Sign Return to training first.',
  );

  // The hamstrings recorded here (Not met), three lines Met and one Not met.
  await row(HAMSTRINGS).getByText('Record a reading').click();
  await row(HAMSTRINGS).getByLabel('Hamstrings involved').fill('30');
  await row(HAMSTRINGS).getByLabel('Hamstrings uninvolved').fill('40');
  await row(HAMSTRINGS).getByRole('button', { name: 'Save reading' }).click();
  await expect(stateOf(HAMSTRINGS)).toHaveText('Not met');
  await expect(row(HAMSTRINGS)).toContainText('LSI 75% · Not yet (recorded here');
  for (const key of [VALGUS, SPORT, LOAD]) {
    await row(key).getByRole('button', { name: 'Met', exact: true }).click();
    await expect(stateOf(key)).toHaveText('Met');
  }
  await row(MIND).getByRole('button', { name: 'Not met', exact: true }).click();
  await expect(stateOf(MIND)).toHaveText('Not met');
  await expect(clearance('rehabilitation_complete').getByTestId('clearance-blocked')).toHaveText(
    '2 tests not met. Add an override reason.',
  );

  // Each Not met overridden with a written reason.
  for (const [key, reason] of [
    [HAMSTRINGS, 'Hamstring LSI 75%; agreed graded return with the club physio.'],
    [MIND, 'ACL-RSI due next week; patient returning to training only.'],
  ] as const) {
    await row(key).getByText('Override', { exact: true }).click();
    await row(key).getByRole('textbox').fill(reason);
    await row(key).getByRole('button', { name: 'Save override' }).click();
    await expect(stateOf(key)).toHaveText('Overridden');
    await expect(row(key).getByTestId('readiness-override')).toContainText(reason);
  }
  await expect(clearance('rehabilitation_complete').getByTestId('clearance-blocked')).toHaveCount(
    0,
  );
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: test.info().outputPath('readiness-panel.png'), fullPage: true });

  // The three statuses, in order.
  for (const [status, label] of [
    ['rehabilitation_complete', 'Rehabilitation complete'],
    ['return_to_training', 'Return to training'],
    ['return_to_sport', 'Return to sport'],
  ] as const) {
    await clearance(status)
      .getByRole('button', { name: `Sign ${label}` })
      .click();
    await expect(clearance(status)).toContainText(`Signed by ${consultant.name}`);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: test.info().outputPath('clearances-signed.png'), fullPage: true });
});
