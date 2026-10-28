import { expect, test } from '@playwright/test';
import { removeCalendarRows, startedAppointment } from './calendar';
import { signedConsultation } from './consultations';
import { removePipelineRows } from './intake';
import { consultationTypeId, submittedWithAlert } from './my-patients';
import { testPatient } from './patients';
import { activePlan } from './plan-sheet';
import { signIn, signInWithCode, temporaryDesk, temporaryWithCode } from './staff';

// PAT-04 done when: the four questions from the bundled message, answers stored by centre and
// physio. Decisions (recommended defaults, user's standing approval of 28 October 2026): the
// Blueprint's four questions, Yes or No, an optional comment; until WhatsApp, the desk shows
// "Rate your visit" as a QR; the Centre Manager reads the answers by centre and physio.

const physios: string[] = [];
const visits: string[] = [];
test.afterEach(async () => {
  await removePipelineRows(visits.splice(0));
  if (physios.length) await removeCalendarRows(physios.splice(0));
});

test('the patient rates their consultation from the desk’s QR, and the manager reads it', async ({
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

  const desk = await temporaryDesk();
  await signIn(page, desk.email);
  await page.goto(`/app/plans/${episodeId}`);
  const qr = page.getByTestId('rate-your-visit-qr');
  await qr.getByRole('button', { name: 'Show Rate your visit QR' }).click();
  await expect(qr.getByRole('img', { name: /QR code for the patient/ })).toBeVisible();
  const path = (await qr.getByTestId('rate-your-visit-path').textContent())?.trim() ?? '';
  expect(path).toMatch(/^\/p\/[^/]+$/);

  // The patient's phone, signed out: four Yes / No questions and a comment.
  const phone = await browser.newContext(test.info().project.use);
  const mine = await phone.newPage();
  await mine.goto(path);
  const form = mine.getByTestId('feedback-form');
  await expect(form.getByTestId('feedback-question')).toHaveCount(4);
  await expect(form).toContainText('Was your problem explained clearly?');
  // Sent with an answer missing: asked again, keeping the others.
  const question = (text: string) => form.getByRole('group', { name: text });
  await question('Was your problem explained clearly?').getByText('Yes', { exact: true }).click();
  await mine.getByRole('button', { name: 'Send' }).click();
  await expect(
    mine.getByRole('alert').filter({ hasText: 'Please answer the questions marked below.' }),
  ).toBeVisible();
  await expect(form.getByText('Please choose Yes or No.')).toHaveCount(3);
  await expect(
    question('Was your problem explained clearly?').getByRole('radio', { name: 'Yes' }),
  ).toBeChecked();
  await question('Did you understand the proposed treatment plan?')
    .getByText('No', { exact: true })
    .click();
  await question('Were your questions answered?').getByText('Yes', { exact: true }).click();
  await question('Were treatment options and charges explained transparently?')
    .getByText('Yes', { exact: true })
    .click();
  await mine
    .getByLabel(/Anything else you would like to tell us/)
    .fill('Please explain the plan again');
  expect(await mine.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await mine.screenshot({ path: test.info().outputPath('feedback-form.png'), fullPage: true });
  await mine.getByRole('button', { name: 'Send' }).click();
  await expect(mine.getByTestId('patient-link-status')).toHaveText(
    'Thank you. Your feedback has reached the clinic.',
  );
  // Opened again: the same thanks, no form.
  await mine.reload();
  await expect(mine.getByTestId('feedback-form')).toHaveCount(0);
  await phone.close();

  // The desk now sees it received.
  await page.reload();
  await qr.getByRole('button', { name: 'Show Rate your visit QR' }).click();
  await expect(qr.getByTestId('rate-your-visit-received')).toBeVisible();

  // The Centre Manager at HSR Layout reads it by centre and by the physio who held it.
  const manager = await temporaryWithCode('centre_manager', ['HSR Layout']);
  const office = await browser.newContext(test.info().project.use);
  const desktop = await office.newPage();
  await signInWithCode(desktop, manager.email, manager.secret);
  await desktop.goto('/app/dashboard/feedback?window=30');
  await expect(desktop.getByTestId('feedback-by-centre')).toContainText('HSR Layout');
  const byPhysio = desktop
    .getByTestId('feedback-by-physio')
    .getByTestId('feedback-tally')
    .filter({ hasText: physio.name });
  await expect(byPhysio).toContainText('1 answered');
  await expect(byPhysio).toContainText('0 Yes · 1 No');
  await expect(desktop.getByTestId('feedback-comments-list')).toContainText(
    'Please explain the plan again',
  );
  expect(
    await desktop.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBe(true);
  await desktop.screenshot({
    path: test.info().outputPath('feedback-dashboard.png'),
    fullPage: true,
  });
  await office.close();
});
