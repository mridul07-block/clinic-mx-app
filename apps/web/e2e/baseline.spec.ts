import { expect, test, type Locator } from '@playwright/test';
import { completeVisit } from './bills';
import { physioAtHsr, removeCalendarRows, startedAppointment } from './calendar';
import { consultationMeasures, frozenBaselineOf, signedConsultation } from './consultations';
import { removePipelineRows } from './intake';
import { consultationTypeId, submittedWithAlert } from './my-patients';
import { testPatient } from './patients';
import { activePlan } from './plan-sheet';
import { signInWithCode, temporaryWithCode } from './staff';

// OUT-01 done when: consultation measures within 7 days are reused and missing markers are
// requested at session 1. Decisions (user, 26 October 2026): the region's markers (the workbook's
// "Baseline | Current" rows) always, and anything else the consultation took; counted back from
// session 1's start; each missing marker recorded or Not tested with a reason before closing;
// questionnaires wait for OUT-02.

const physios: string[] = [];
const visits: string[] = [];
test.afterEach(async () => {
  await removePipelineRows(visits.splice(0));
  if (physios.length) await removeCalendarRows(physios.splice(0));
});

const PAIN = 'knee.marker.primary_task_pain_nrs_0_10'; // gitleaks:allow
const QUADRICEPS = 'knee.lsi.quadriceps'; // gitleaks:allow

test('session 1 reuses the consultation’s measures, asks for the missing knee markers and freezes the baseline', async ({
  page,
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
  // The consultation measured the knee 3 days ago: task pain and quadriceps strength.
  const { consultationId } = await signedConsultation(consultationVisit.id, physio.id, {
    sections: { objective: { region: 'knee', side: 'right' } },
  });
  await consultationMeasures(consultationId, 3, [
    { key: PAIN, value: 6, unit: '/10' },
    { key: QUADRICEPS, limb: 'involved', value: 32, unit: 'kg' },
    { key: QUADRICEPS, limb: 'uninvolved', value: 40, unit: 'kg' },
  ]);
  await completeVisit(consultationVisit.id);
  const episodeId = await activePlan(consultationId);
  const session = await startedAppointment(physio.id, patient.id, 30, {
    minutes: 45,
    values: { episodeId, status: 'checked_in', arrivedAt: new Date(), checkedInBy: physio.id },
  });

  await signInWithCode(page, physio.email, physio.secret);
  await page.goto('/app/my-patients');
  await page
    .locator(`[data-testid="my-patient"][data-appointment="${session.id}"]`)
    .getByRole('button', { name: `Start session for ${patient.name}` })
    .click();
  await page.waitForURL((url) => url.pathname === `/app/sessions/${session.id}`);
  const note = page.getByRole('region', { name: 'Session note' });
  const baseline = note.getByTestId('baseline');
  const item = (name: string) => baseline.getByTestId('baseline-item').filter({ hasText: name });

  // Reused as the consultation recorded them, with the day they were taken.
  await expect(baseline.locator('[data-source="consultation"]')).toHaveCount(2);
  await expect(item('Quadriceps')).toContainText(
    'Involved 32 kg, uninvolved 40 kg · LSI 80% · Not yet',
  );
  await expect(item('Quadriceps')).toContainText('Consultation, ');
  await expect(item('Primary task pain (NRS 0-10)')).toContainText('6/10');
  // The other knee markers are asked for; Close waits for them.
  const asked = baseline.locator('[data-source="requested"]');
  await expect(asked).toHaveCount(6);
  const blockers = note.getByTestId('close-blockers');
  await expect(blockers).toContainText(
    'Record Effusion grade (0-3), or mark it Not tested with a reason.',
  );

  // The rest of the note.
  await note.locator('label').filter({ hasText: /^No$/ }).click();
  await note.getByLabel('Pain at rest').fill('2');
  await note.getByLabel('Pain during activity').fill('4');
  await note.getByLabel('Pain after treatment').fill('1');
  await note
    .locator('label')
    .filter({ hasText: /^Better$/ })
    .click();
  await note
    .locator('label')
    .filter({ hasText: /^Progress$/ })
    .click();

  // Grades are 0 to 3 in one tap; the others take their reading; one is not tested.
  const grade = (row: Locator, value: string) => row.getByText(value, { exact: true }).click();
  await grade(item('Single-leg step-down quality (0-3)'), '2');
  await item('Effusion grade (0-3)').getByLabel('Not tested').check();
  await expect(blockers).toContainText('Give the reason Effusion grade (0-3) was not tested.');
  await item('Effusion grade (0-3)')
    .getByLabel('Why it was not tested')
    .fill('Swelling not assessable today');
  await item('Knee flexion range').getByLabel('Knee flexion range').fill('120');
  await item('Extension lag').getByLabel('Extension lag').fill('5');
  await item('PROM score').getByLabel('PROM score (KOOS / Kujala / VISA-P)').fill('62');
  await item('Walking or running tolerance').getByLabel('Walking or running tolerance').fill('20');
  await expect(blockers).toHaveCount(0);
  await expect(note.getByRole('status')).toHaveText('Saved');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: test.info().outputPath('baseline.png'), fullPage: true });

  await note.getByRole('button', { name: 'Close session' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Session closed.' })).toBeVisible();

  // Signed, the baseline is frozen: reused, recorded at session 1, or not tested with the reason.
  await page.goto(`/app/sessions/${session.id}`);
  await expect(page.getByTestId('session-signed')).toContainText(`Signed by ${physio.name}`);
  await expect(baseline.locator('[data-source="requested"]')).toHaveCount(0);
  await expect(item('Knee flexion range')).toContainText('Session 1');
  await expect(item('Knee flexion range')).toContainText('120 deg');
  await expect(item('Single-leg step-down quality (0-3)')).toContainText('2');
  await expect(item('Effusion grade (0-3)')).toContainText('Not tested');
  await expect(item('Effusion grade (0-3)')).toContainText('Swelling not assessable today');
  await expect(item('Quadriceps')).toContainText('Consultation, ');
  await page.screenshot({ path: test.info().outputPath('baseline-signed.png'), fullPage: true });
  const frozen = await frozenBaselineOf(episodeId);
  expect(frozen).toHaveLength(8);
  expect(frozen.filter((row) => row.source === 'consultation').map((row) => row.key)).toEqual([
    QUADRICEPS,
    PAIN,
  ]);
  expect(frozen.filter((row) => row.source === 'not_tested')).toHaveLength(1);
});
