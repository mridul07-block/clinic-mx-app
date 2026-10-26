import { expect, test, type Locator } from '@playwright/test';
import { completeVisit } from './bills';
import { removeCalendarRows, startedAppointment } from './calendar';
import { signedConsultation } from './consultations';
import { appointmentTypeIdOf, finalTestOf, reassessedEpisode } from './final-testing';
import { removePipelineRows } from './intake';
import { consultationTypeId, submittedWithAlert } from './my-patients';
import { testPatient } from './patients';
import { activePlan } from './plan-sheet';
import { signInWithCode, temporaryWithCode } from './staff';

// OUT-07 done when: exactly the baseline markers listed with before and after. Decisions (user,
// 27 October 2026): on the episode's Review and discharge screen, opened by Start review, anyone
// with the Consultant tick retests the baseline's measures, each recorded or Not tested with a
// reason, and signs once; the list shows baseline, session 4, final and the change.

const physios: string[] = [];
const visits: string[] = [];
test.afterEach(async () => {
  await removePipelineRows(visits.splice(0));
  if (physios.length) await removeCalendarRows(physios.splice(0));
});

test('the review retests exactly the baseline, signed once, with before and after', async ({
  page,
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
  await reassessedEpisode({
    physioId: physio.id,
    patientId: patient.id,
    episodeId,
    consultationId,
  });
  const review = await startedAppointment(consultant.id, patient.id, 30, {
    minutes: 45,
    values: {
      episodeId,
      appointmentTypeId: await appointmentTypeIdOf('review'),
      status: 'checked_in',
      arrivedAt: new Date(),
      checkedInBy: consultant.id,
    },
  });

  // Start review opens the episode's Review and discharge screen.
  await signInWithCode(page, consultant.email, consultant.secret);
  await page.goto('/app/my-patients');
  await page
    .locator(`[data-testid="my-patient"][data-appointment="${review.id}"]`)
    .getByRole('button', { name: `Start review for ${patient.name}` })
    .click();
  await page.waitForURL((url) => url.pathname === `/app/episodes/${episodeId}/review`);
  await expect(page.getByRole('heading', { name: 'Review and discharge' })).toBeVisible();

  // Exactly the baseline's three measures, each with its baseline and session 4 readings.
  const form = page.getByTestId('final-test-form');
  const item = (name: string) => form.getByTestId('final-test-item').filter({ hasText: name });
  await expect(form.getByTestId('final-test-item')).toHaveCount(3);
  await expect(item('Quadriceps')).toContainText(
    'Baseline: Involved 32 kg, uninvolved 40 kg · LSI 80% · Not yet',
  );
  await expect(item('Quadriceps')).toContainText('Session 4: Involved 36 kg, uninvolved 39 kg');
  await expect(item('Primary task pain (NRS 0-10)')).toContainText('Session 4: 3/10');
  await expect(item('Effusion grade (0-3)')).toContainText(
    'Baseline: Not tested (Swelling not assessable)',
  );
  await expect(item('Effusion grade (0-3)')).toContainText('Session 4: Not tested (Still swollen)');

  // Signing waits for each measure.
  const sign = form.getByRole('button', { name: 'Sign final testing' });
  const blockers = form.getByTestId('final-test-blockers');
  await expect(sign).toBeDisabled();
  await expect(blockers).toContainText(
    'Record both sides of Quadriceps, or mark it Not tested with a reason.',
  );
  await item('Quadriceps').getByLabel('Quadriceps involved').fill('38');
  await item('Quadriceps').getByLabel('Quadriceps uninvolved').fill('40');
  await expect(item('Quadriceps').getByTestId('final-test-live-change')).toHaveText(
    'LSI 80% → 95%',
  );
  await item('Primary task pain (NRS 0-10)').getByLabel('Primary task pain (NRS 0-10)').fill('1');
  await item('Effusion grade (0-3)').getByRole('checkbox', { name: 'Not tested' }).check();
  await expect(blockers).toContainText('Give the reason Effusion grade (0-3) was not tested.');
  await expect(sign).toBeDisabled();
  await item('Effusion grade (0-3)').getByLabel('Why it was not tested').fill('Knee taped today');
  await expect(blockers).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: test.info().outputPath('final-test-form.png'), fullPage: true });
  await sign.click();

  // Before and after: baseline, session 4, final and the change; signed, and never a form again.
  const testing = page.getByTestId('final-testing');
  const row = (name: string) => testing.getByTestId('final-test-row').filter({ hasText: name });
  await expect(testing.getByTestId('final-test-signed')).toContainText(
    `Signed by ${consultant.name}`,
  );
  await expect(row('Quadriceps').getByTestId('final-test-change')).toHaveText('LSI 80% → 95%');
  await expect(row('Primary task pain (NRS 0-10)')).toContainText('Session 4');
  await expect(row('Primary task pain (NRS 0-10)').getByTestId('final-test-change')).toHaveText(
    '6/10 → 1/10',
  );
  await expect(row('Effusion grade (0-3)')).toContainText('Not tested: Knee taped today');
  await expect(form).toHaveCount(0);
  expect(await finalTestOf(episodeId)).toEqual({ signed_by: consultant.id, readings: 3 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: test.info().outputPath('final-test-signed.png'), fullPage: true });
  await page.reload();
  await expect(testing.getByTestId('final-test-row')).toHaveCount(3);
  await expect(page.getByTestId('final-test-form')).toHaveCount(0);

  // The visit is In progress: My patients opens the review again, as does the patient's record.
  await page.goto('/app/my-patients');
  const visit: Locator = page.locator(
    `[data-testid="my-patient"][data-appointment="${review.id}"]`,
  );
  await visit.getByTestId('open-review').click();
  await page.waitForURL((url) => url.pathname === `/app/episodes/${episodeId}/review`);
  await page.goto(`/app/patients/${patient.id}`);
  await page.getByTestId('summary-review').click();
  await page.waitForURL((url) => url.pathname === `/app/episodes/${episodeId}/review`);
});
