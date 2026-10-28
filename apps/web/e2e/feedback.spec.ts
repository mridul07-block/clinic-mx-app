import { expect, test } from '@playwright/test';
import { removeCalendarRows, startedAppointment } from './calendar';
import { signedConsultation } from './consultations';
import { removePipelineRows } from './intake';
import { consultationTypeId, submittedWithAlert } from './my-patients';
import { moveEpisode, testPatient } from './patients';
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
  // PAT-08: the No gave the Centre Managers at HSR Layout a service recovery task, counted on Alerts.
  await desktop.goto('/app/tasks');
  await expect(
    desktop
      .getByTestId('service-recovery')
      .filter({ hasText: 'No: Did you understand the proposed treatment plan?' })
      .first(),
  ).toBeVisible();
  await desktop.goto('/app/dashboard/alerts');
  await expect(
    desktop.locator('[data-testid="alert-count"][data-item="service_recovery"]'),
  ).toBeVisible();
  await desktop.goto('/app/dashboard/feedback?window=30');
  await expect(desktop.getByTestId('after-consultation-by-centre')).toContainText('HSR Layout');
  const byPhysio = desktop
    .getByTestId('after-consultation-by-physio')
    .getByTestId('feedback-tally')
    .filter({ hasText: physio.name });
  await expect(byPhysio).toContainText('1 answered');
  await expect(byPhysio).toContainText('0 Yes · 1 No');
  await expect(desktop.getByTestId('after-consultation-comments')).toContainText(
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

// PAT-07 done when: four questions plus a 0 to 10 recommendation score at discharge. Decisions
// (recommended defaults, user's standing approval of 28 October 2026): the Blueprint's three
// Yes / No discharge questions, its fourth as the comment, and the usual recommendation question
// until the client words theirs; the desk shows it as a QR; the manager reads the Net Promoter
// Score against the clinic's target.
test('a discharged patient gives discharge feedback with a score, and the manager reads the Net Promoter Score', async ({
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
  // Not discharged yet: no discharge feedback.
  await page.goto(`/app/plans/${episodeId}`);
  await expect(page.getByTestId('rate-your-visit-qr')).toBeVisible();
  await expect(page.getByTestId('discharge-feedback-qr')).toHaveCount(0);
  await moveEpisode(episodeId, 'active', ['discharged'], 'patient_choice');
  await page.reload();
  const qr = page.getByTestId('discharge-feedback-qr');
  await qr.getByRole('button', { name: 'Show discharge feedback QR' }).click();
  await expect(qr.getByRole('img', { name: /QR code for the patient/ })).toBeVisible();
  const path = (await qr.getByTestId('discharge-feedback-path').textContent())?.trim() ?? '';
  expect(path).toMatch(/^\/p\/[^/]+$/);

  const phone = await browser.newContext(test.info().project.use);
  const mine = await phone.newPage();
  await mine.goto(path);
  const form = mine.getByTestId('feedback-form');
  await expect(form.getByRole('heading', { name: 'Your care with us' })).toBeVisible();
  await expect(form.getByTestId('feedback-question')).toHaveCount(3);
  const question = (text: string) => form.getByRole('group', { name: text });
  await question('Have you achieved the functional goals that matter most to you?')
    .getByText('Yes', { exact: true })
    .click();
  await question('Do you understand how to continue your rehabilitation independently?')
    .getByText('Yes', { exact: true })
    .click();
  await question('Were you satisfied with your clinical care and communication?')
    .getByText('Yes', { exact: true })
    .click();
  // Sent without a score: asked for it.
  await mine.getByRole('button', { name: 'Send' }).click();
  await expect(form.getByText('Please choose a number from 0 to 10.')).toBeVisible();
  const score = form.getByTestId('feedback-score');
  await score.getByText('10', { exact: true }).click();
  const improve = `More evening slots ${crypto.randomUUID().slice(0, 8)}`;
  await mine.getByLabel('What could Movementology improve? (optional)').fill(improve);
  expect(await mine.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await mine.screenshot({ path: test.info().outputPath('discharge-feedback.png'), fullPage: true });
  await mine.getByRole('button', { name: 'Send' }).click();
  await expect(mine.getByTestId('patient-link-status')).toHaveText(
    'Thank you. Your feedback has reached the clinic.',
  );
  await phone.close();

  await page.reload();
  await qr.getByRole('button', { name: 'Show discharge feedback QR' }).click();
  await expect(qr.getByTestId('discharge-feedback-received')).toBeVisible();

  const manager = await temporaryWithCode('centre_manager', ['HSR Layout']);
  const office = await browser.newContext(test.info().project.use);
  const desktop = await office.newPage();
  await signInWithCode(desktop, manager.email, manager.secret);
  await desktop.goto('/app/dashboard/feedback?window=30');
  await expect(desktop.getByTestId('net-promoter')).toContainText('Net Promoter Score');
  await expect(desktop.getByTestId('net-promoter')).toContainText('Target: Over 60');
  await expect(desktop.getByTestId('at-discharge-by-centre')).toContainText('HSR Layout');
  await expect(desktop.getByTestId('at-discharge-comments')).toContainText(improve);
  expect(
    await desktop.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBe(true);
  await desktop.screenshot({
    path: test.info().outputPath('discharge-dashboard.png'),
    fullPage: true,
  });
  await office.close();
});
