import { expect, test } from '@playwright/test';
import { completeVisit } from './bills';
import { removeCalendarRows, startedAppointment } from './calendar';
import { signedConsultation } from './consultations';
import { reassessedEpisode } from './final-testing';
import { removePipelineRows } from './intake';
import { consultationTypeId, submittedWithAlert } from './my-patients';
import { testPatient } from './patients';
import { activePlan } from './plan-sheet';
import { QUADRICEPS } from './reassessment';
import { signInWithCode, temporaryWithCode } from './staff';

// OUT-03 done when: pain line, LSI bullet graphs (questionnaire lines join with OUT-02, the week
// strip with PAT-01). Decisions (user, 27 October 2026): pain during activity from the consultation
// over the signed sessions, the rest in the table; a bullet per strength or hop LSI, the newest
// against its pass with the first marked; hand-built SVG.

const physios: string[] = [];
const visits: string[] = [];
test.afterEach(async () => {
  await removePipelineRows(visits.splice(0));
  if (physios.length) await removeCalendarRows(physios.splice(0));
});

test('the Progress tab draws pain during activity and the quadriceps LSI against its pass', async ({
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
  const { consultationId } = await signedConsultation(consultationVisit.id, consultant.id, {
    sections: {
      subjective: { notes: '', confirmed: { pain_now: 3, pain_activity: 6 } },
      objective: { region: 'knee', side: 'right' },
    },
  });
  await completeVisit(consultationVisit.id);
  const episodeId = await activePlan(consultationId);
  // Sessions 1 to 3 (activity pain 4) with quadriceps 32/40 from the consultation, then session 4
  // (activity pain 3) retaking quadriceps at 36/39.
  await reassessedEpisode({
    physioId: physio.id,
    patientId: patient.id,
    episodeId,
    consultationId,
  });

  await signInWithCode(page, physio.email, physio.secret);
  await page.goto(`/app/patients/${patient.id}?tab=progress`);
  const pain = page.getByTestId('progress-pain');
  await expect(pain.getByTestId('progress-pain-sentence')).toHaveText(
    'Pain during activity 6 at the consultation, 3 at session 4.',
  );
  await expect(pain.getByTestId('line-point')).toHaveCount(5);
  await pain.getByText('Show as table').click();
  await expect(pain.getByRole('row')).toHaveCount(6);
  await expect(pain.getByRole('row').nth(1)).toContainText('Consultation');
  await expect(pain.getByRole('row').nth(1)).toContainText('6');

  const quadriceps = page.locator(`[data-testid="progress-bullet"][data-measure="${QUADRICEPS}"]`);
  await expect(quadriceps).toContainText('Pass');
  await expect(quadriceps.getByTestId('progress-bullet-text')).toContainText(
    'LSI 92%, from 80% at baseline (session,',
  );
  await expect(quadriceps.getByTestId('bullet-earlier')).toHaveCount(1);
  await expect(quadriceps).toContainText('Target 90%');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: test.info().outputPath('progress-tab.png'), fullPage: true });
});
