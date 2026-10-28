import { expect, test } from '@playwright/test';
import { removeCalendarRows, startedAppointment } from './calendar';
import { signedConsultation } from './consultations';
import { removePipelineRows } from './intake';
import { consultationTypeId, submittedWithAlert } from './my-patients';
import { testPatient } from './patients';
import { activePlan } from './plan-sheet';
import { signedSessionsWithBaseline } from './reassessment';
import { signIn, signInWithCode, temporaryDesk, temporaryWithCode } from './staff';

// PAT-05 done when: Better, Same, Still sore; Still sore alerts the physio. Recommended defaults
// (29 October 2026): signing session 1 queues the WhatsApp check for the next day; until WA-06
// sends it, the desk shows it as a QR; one tap answers it, once; Still sore gives the treating
// physio a high review task.

const physios: string[] = [];
const visits: string[] = [];
test.afterEach(async () => {
  await removePipelineRows(visits.splice(0));
  if (physios.length) await removeCalendarRows(physios.splice(0));
});

test('the patient taps Still sore on the desk’s QR, and the physio gets the task', async ({
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

  // Before the first treatment is signed, the check is not open.
  const desk = await temporaryDesk();
  await signIn(page, desk.email);
  await page.goto(`/app/plans/${episodeId}`);
  const qr = page.getByTestId('first-treatment-check-qr');
  await qr.getByRole('button', { name: 'Show first treatment check QR' }).click();
  await expect(qr).toContainText('The check opens once the first treatment is signed.');

  await signedSessionsWithBaseline({
    physioId: physio.id,
    patientId: patient.id,
    episodeId,
    consultationId,
  });
  await page.reload();
  await qr.getByRole('button', { name: 'Show first treatment check QR' }).click();
  await expect(qr.getByRole('img', { name: /QR code for the patient/ })).toBeVisible();
  const path = (await qr.getByTestId('first-treatment-check-path').textContent())?.trim() ?? '';
  expect(path).toMatch(/^\/p\/[^/]+$/);

  // The patient's phone, signed out: one question, three answers, one tap.
  const phone = await browser.newContext(test.info().project.use);
  const mine = await phone.newPage();
  await mine.goto(path);
  const form = mine.getByTestId('first-treatment-form');
  await expect(form).toContainText('How do you feel since your first treatment?');
  await expect(form.getByRole('button')).toHaveText(['Better', 'Same', 'Still sore']);
  expect(await mine.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await mine.screenshot({
    path: test.info().outputPath('first-treatment-check.png'),
    fullPage: true,
  });
  await form.getByRole('button', { name: 'Still sore' }).click();
  await expect(mine.getByTestId('patient-link-status')).toHaveText(
    'Thank you. Your feedback has reached the clinic.',
  );
  await mine.reload();
  await expect(mine.getByTestId('first-treatment-form')).toHaveCount(0);
  await phone.close();

  // The desk sees it received.
  await page.reload();
  await qr.getByRole('button', { name: 'Show first treatment check QR' }).click();
  await expect(qr.getByTestId('first-treatment-check-received')).toBeVisible();

  // The treating physio has the high review task.
  const office = await browser.newContext(test.info().project.use);
  const theirs = await office.newPage();
  await signInWithCode(theirs, physio.email, physio.secret);
  await theirs.goto('/app/tasks');
  const card = theirs
    .getByTestId('task-card')
    .filter({ hasText: 'Still sore the day after the first treatment' });
  await expect(card).toContainText('Clinical review: still sore after the first treatment');
  await expect(card).toContainText('High');
  await office.close();
});
