import {
  createDb,
  document as documentRow,
  job,
  message,
  systemActor,
  withActor,
} from '@clinic-mx/db';
import { addDays, istDate, screeningItems } from '@clinic-mx/schemas';
import { expect, test, type Page } from '@playwright/test';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { removeCalendarRows, startedAppointment } from './calendar';
import { draftSections, savedConsultation, signedRows, submittedAnswers } from './consultations';
import { libraryExercise, retireExercises } from './exercises';
import { pipelineOf, removePipelineRows } from './intake';
import { runDueJobs, tickUntil } from './jobs';
import { checkedIn, consultationTypeId, submittedWithAlert } from './my-patients';
import { testPatient } from './patients';
import { signIn, signInWithCode, temporaryDesk, temporaryWithCode } from './staff';

// CLN-02 done when: Start consultation opens the consultation, a vertical stepper of Subjective,
// Screening, Objective, Assessment, Plan and Sign; one section at a time with Back and Next
// pinned on phones; everything autosaves, offline too. Decisions (user, 24 October 2026): a notes
// box per section; no consultation before the health form; on desktop the stepper beside one
// section. Each test has its own temporary consultant at HSR Layout.

const physios: string[] = [];
const visits: string[] = [];
const libraryExercises: string[] = [];
test.afterEach(async () => {
  await retireExercises(libraryExercises.splice(0));
  await removePipelineRows(visits.splice(0));
  if (physios.length) await removeCalendarRows(physios.splice(0));
});

/** A temporary consultant with a checked in consultation today, its form submitted or not. */
async function consultationToday(options: { submitted: boolean }) {
  const physio = await temporaryWithCode('physiotherapist', ['HSR Layout'], { consultant: true });
  physios.push(physio.id);
  const patient = await testPatient();
  const visit = await startedAppointment(physio.id, patient.id, 5, {
    minutes: 5,
    values: { appointmentTypeId: await consultationTypeId() },
  });
  visits.push(visit.id);
  const desk = await temporaryDesk();
  await checkedIn(visit.id, desk.id);
  if (options.submitted) await submittedWithAlert(visit.id, patient.id);
  return { physio, patient, visit, desk };
}

const notes = (page: Page) => page.getByRole('textbox', { name: 'Notes' });
const stepTitle = (page: Page) => page.locator('#consultation-step');
const sectionOf = (page: Page) => new URL(page.url()).searchParams.get('section');
const startConsultation = (page: Page, name: string) =>
  page.getByRole('button', { name: `Start consultation for ${name}` }).click();

test('Start consultation opens the stepper; each section autosaves and survives a reload', async ({
  page,
}, testInfo) => {
  const phone = testInfo.project.name === 'phone';
  const { physio, patient, visit } = await consultationToday({ submitted: true });
  await signInWithCode(page, physio.email, physio.secret);
  await startConsultation(page, patient.name);
  await expect(page).toHaveURL(/\/app\/consultations\/[0-9a-f-]+$/);
  await expect(page.getByRole('heading', { name: 'Consultation', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: patient.name })).toBeVisible();
  await expect(stepTitle(page)).toHaveText('Subjective');

  await notes(page).fill('Knee pain on stairs for three weeks.');
  await expect(page.getByText('Saved', { exact: true })).toBeVisible();
  await expect
    .poll(async () => (await savedConsultation(visit.id))?.sections.subjective?.notes)
    .toBe('Knee pain on stairs for three weeks.');

  const actions = page.getByTestId('step-actions');
  if (phone) {
    // One section per screen: the stepper is hidden, Next stays pinned in view.
    await expect(page.getByRole('navigation', { name: 'Consultation steps' })).toBeHidden();
    await expect(page.getByText('Step 1 of 6')).toBeVisible();
    await notes(page).fill(`${'A longer history line.\n'.repeat(40)}Knee pain on stairs.`);
    await page.mouse.wheel(0, 400);
    await expect(actions.getByRole('link', { name: 'Next' })).toBeInViewport();
  } else {
    // The vertical stepper sits beside the section; a step is a click away.
    const steps = page.getByRole('navigation', { name: 'Consultation steps' });
    // Each step shows its number; a written one says so to screen readers.
    await expect(steps.getByRole('link')).toHaveText([
      /^1Subjective, notes added$/,
      /^2Screening$/,
      /^3Objective$/,
      /^4Assessment$/,
      /^5Plan$/,
      /^6Sign$/,
    ]);
    await expect(steps.getByRole('link', { name: /Subjective/ })).toHaveAttribute(
      'aria-current',
      'step',
    );
  }
  await actions.getByRole('link', { name: 'Next' }).click();
  await expect(stepTitle(page)).toHaveText('Screening');
  expect(sectionOf(page)).toBe('screening');
  await notes(page).fill('No warning signs reported.');
  await expect(page.getByText('Saved', { exact: true })).toBeVisible();

  // A reload keeps the section and what was written; Back returns to the one before.
  await page.reload();
  await expect(stepTitle(page)).toHaveText('Screening');
  await expect(notes(page)).toHaveValue('No warning signs reported.');
  await page.getByTestId('step-actions').getByRole('link', { name: 'Back' }).click();
  await expect(stepTitle(page)).toHaveText('Subjective');
  await expect(notes(page)).toHaveValue(/Knee pain on stairs/);

  if (!phone) {
    await page
      .getByRole('navigation', { name: 'Consultation steps' })
      .getByRole('link', { name: 'Assessment' })
      .click();
    await expect(stepTitle(page)).toHaveText('Assessment');
    expect(sectionOf(page)).toBe('assessment');
  }

  // Sign lists what each section holds.
  await page.goto(`${new URL(page.url()).pathname}?section=sign`);
  await expect(stepTitle(page)).toHaveText('Sign');
  const rows = page.getByTestId('sign-section');
  await expect(rows).toHaveText([
    /Subjective\s*Notes added/,
    /Screening\s*Notes added/,
    /Objective\s*Nothing yet/,
    /Assessment\s*Nothing yet/,
    /Plan\s*Nothing yet/,
  ]);
  await page.getByRole('link', { name: 'Edit Objective' }).click();
  await expect(stepTitle(page)).toHaveText('Objective');
});

test('offline, an edit waits on the device and is saved on reconnect', async ({
  page,
  context,
}) => {
  const { physio, patient, visit } = await consultationToday({ submitted: true });
  await signInWithCode(page, physio.email, physio.secret);
  await startConsultation(page, patient.name);
  await expect(stepTitle(page)).toHaveText('Subjective');
  await context.setOffline(true);
  await notes(page).fill('Written with no signal');
  await expect(page.getByText('Offline, changes will sync')).toBeVisible();
  await expect(page.getByText('Saved on this device', { exact: true })).toBeVisible();
  await context.setOffline(false);
  await expect(page.getByText('Saved', { exact: true })).toBeVisible();
  await expect
    .poll(async () => (await savedConsultation(visit.id))?.sections.subjective?.notes)
    .toBe('Written with no signal');
});

test('no consultation before the health form, and nobody else opens one', async ({
  page,
  browser,
}) => {
  const { physio, patient, visit, desk } = await consultationToday({ submitted: false });
  await signInWithCode(page, physio.email, physio.secret);
  await startConsultation(page, patient.name);
  await expect(
    page.getByText(
      'The health form is needed before the consultation. The front desk can open it on the tablet.',
    ),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/app\/my-patients$/);
  expect(await savedConsultation(visit.id)).toBeUndefined();

  // Once the form is in, it opens; the desk cannot open it.
  await submittedWithAlert(visit.id, patient.id);
  await startConsultation(page, patient.name);
  await expect(page).toHaveURL(/\/app\/consultations\/[0-9a-f-]+$/);
  const address = page.url();
  const deskPage = await (await browser.newContext()).newPage();
  await signIn(deskPage, desk.email);
  await deskPage.goto(address);
  await expect(deskPage).toHaveURL(/\/app\/not-allowed/);
  await deskPage.context().close();
});

// CLN-03 done when: Patient reported fields switch to Clinician confirmed when edited. Decisions
// (user, 24 October 2026): problem, activity, history and about fields; only an edit confirms; the
// patient's words stay beneath.
test('Subjective shows the health form as Patient reported; an edit makes it Clinician confirmed', async ({
  page,
}, testInfo) => {
  const { physio, patient, visit } = await consultationToday({ submitted: true });
  await submittedAnswers(visit.id, patient.id, {
    region: 'knee',
    complaint: 'Pain on the stairs',
    pain_now: 6,
    onset: 'gradual',
    pain_site: ['right_knee_front'],
  });
  await signInWithCode(page, physio.email, physio.secret);
  await startConsultation(page, patient.name);
  await expect(stepTitle(page)).toHaveText('Subjective');

  const field = (key: string) =>
    page.locator(`[data-testid="subjective-field"][data-field="${key}"]`);
  await expect(field('complaint')).toContainText('Patient reported');
  await expect(page.getByLabel('Main complaint')).toHaveValue('Pain on the stairs');
  await expect(page.getByLabel('Body region')).toHaveValue('knee');
  await expect(field('surgeries')).toContainText('Not answered');

  // Editing the complaint and the pain confirms them; the patient's words stay beneath.
  await page.getByLabel('Main complaint').fill('Pain going down stairs, worse after running');
  await expect(field('complaint')).toContainText('Clinician confirmed');
  await expect(field('complaint')).toContainText('Patient reported: Pain on the stairs');
  await page.getByLabel('Pain now').fill('4');
  await expect(field('pain_now')).toContainText('Clinician confirmed');
  await expect(field('pain_now')).toContainText('Patient reported: 6 out of 10');
  await page.getByLabel('Surgeries').fill('Knee arthroscopy 2019');
  await expect(field('surgeries')).toContainText('Patient reported: nothing');
  // Untouched answers stay the patient's.
  await expect(field('onset')).toContainText('Patient reported');
  await expect(field('onset')).not.toContainText('Clinician confirmed');
  if (testInfo.project.name === 'desktop') {
    await field('pain_site')
      .getByRole('checkbox', { name: 'Left knee, front' })
      .check({ force: true });
    await expect(field('pain_site')).toContainText('Clinician confirmed');
  }
  await expect(page.getByText('Saved', { exact: true })).toBeVisible();
  await expect
    .poll(async () => (await savedConsultation(visit.id))?.sections.subjective?.confirmed)
    .toMatchObject({
      complaint: 'Pain going down stairs, worse after running',
      pain_now: 4,
      surgeries: 'Knee arthroscopy 2019',
    });

  // After a reload the labels and values hold.
  await page.reload();
  await expect(page.getByLabel('Main complaint')).toHaveValue(
    'Pain going down stairs, worse after running',
  );
  await expect(field('complaint')).toContainText('Clinician confirmed');
  await expect(field('onset')).toContainText('Patient reported');
  await page.goto(`${new URL(page.url()).pathname}?section=sign`);
  await expect(page.getByTestId('sign-section').first()).toContainText(
    testInfo.project.name === 'desktop' ? '4 confirmed' : '3 confirmed',
  );
});

// CLN-04 done when: each screening item confirmed; signing impossible until complete. Decisions
// (user, 24 October 2026): Yes or No tapped on each, nothing preselected; each precaution its own
// item; a changed answer is recorded and marked (CLN-11 acts on it).
test('Screening asks the region’s questions and each precaution; signing waits until all are confirmed', async ({
  page,
}) => {
  const { physio, patient, visit } = await consultationToday({ submitted: true });
  await submittedAnswers(visit.id, patient.id, {
    region: 'back',
    sex: 'female',
    weight_loss: false,
    back_saddle: false,
    night_pain: false,
    health_conditions: ['diabetes'],
  });
  const asked = screeningItems('back', 'female', {}).length;
  await signInWithCode(page, physio.email, physio.secret);
  await startConsultation(page, patient.name);
  await page.getByTestId('step-actions').getByRole('link', { name: 'Next' }).click();
  await expect(stepTitle(page)).toHaveText('Screening');

  const item = (key: string) => page.locator(`[data-testid="screening-item"][data-item="${key}"]`);
  const progress = page.getByTestId('screening-progress');
  await expect(progress).toHaveText(`Region: Back · 0 of ${String(asked)} confirmed`);
  await expect(item('back_saddle')).toContainText('Patient said: No');
  await expect(item('back_saddle')).toContainText('Not confirmed');
  await expect(item('back_saddle').getByRole('radio', { checked: true })).toHaveCount(0);
  await expect(item('neck_dizziness')).toHaveCount(0);
  await expect(item('weight_loss_kg')).toHaveCount(0);
  await expect(item('precaution.pregnancy')).toBeVisible();
  await expect(item('precaution.diabetes')).toContainText('Patient said: Yes');

  // Signing waits.
  await page.goto(`${new URL(page.url()).pathname}?section=sign`);
  await expect(page.getByTestId('sign-gate')).toContainText(
    `Signing needs every screening item confirmed: ${String(asked)} left.`,
  );
  await page.getByRole('link', { name: 'Go to Screening' }).click();
  await expect(stepTitle(page)).toHaveText('Screening');

  // Weight loss confirmed yes asks how much and over how long.
  await item('weight_loss').getByText('Yes', { exact: true }).click();
  await expect(item('weight_loss')).toContainText("Changed from the patient's answer");
  await expect(item('weight_loss_kg')).toBeVisible();
  await item('weight_loss_kg').getByRole('spinbutton').fill('3');
  await item('weight_loss_months').getByRole('spinbutton').fill('2');
  await item('back_saddle').getByText('Yes', { exact: true }).click();
  await expect(item('back_saddle')).toContainText("Changed from the patient's answer");
  await item('precaution.diabetes').getByText('Yes', { exact: true }).click();
  await expect(item('precaution.diabetes')).toContainText('Confirmed');
  await expect(progress).toHaveText(`Region: Back · 5 of ${String(asked + 2)} confirmed`);

  // The rest: No to each question and precaution, 0 minutes of morning stiffness.
  const keys = await page
    .getByTestId('screening-item')
    .evaluateAll((all) => all.map((row) => row.getAttribute('data-item') ?? ''));
  for (const key of keys) {
    const row = item(key);
    if ((await row.getByText('Not confirmed').count()) === 0) continue;
    if ((await row.getByRole('spinbutton').count()) > 0) {
      await row.getByRole('spinbutton').fill('0');
    } else {
      await row.getByText('No', { exact: true }).click();
    }
  }
  await expect(progress).toHaveText(
    `Region: Back · ${String(asked + 2)} of ${String(asked + 2)} confirmed`,
  );
  await expect(page.getByText('Saved', { exact: true })).toBeVisible();
  await expect
    .poll(async () => (await savedConsultation(visit.id))?.sections.screening?.confirmed)
    .toMatchObject({ back_saddle: true, weight_loss_kg: 3, 'precaution.diabetes': true });

  await page.reload();
  await expect(item('back_saddle')).toContainText("Changed from the patient's answer");
  await expect(item('back_saddle').getByRole('radio', { name: 'Yes' })).toBeChecked();
  await page.goto(`${new URL(page.url()).pathname}?section=sign`);
  // Screening no longer holds signing back; the working diagnosis still does (CLN-06).
  await expect(page.getByTestId('sign-gate')).not.toContainText('screening item');
  await expect(page.getByTestId('sign-gate')).toContainText(
    'The working diagnosis needs its four parts',
  );
});

// CLN-05 done when: side by side measures with live LSI, special test rows, 0 to 3 ratings. The
// measures and tests are the workbooks' own (imported with `kb:import --apply`). Decisions (user,
// 24 October 2026): the region's list from the workbook; tests added from the region's list;
// 0 to 3 without invented definitions.
test('Objective takes the region’s measures with live LSI, a 0 to 3 rating and special tests', async ({
  page,
}) => {
  const { physio, patient, visit } = await consultationToday({ submitted: true });
  await submittedAnswers(visit.id, patient.id, { region: 'knee', sex: 'male' });
  await signInWithCode(page, physio.email, physio.secret);
  await startConsultation(page, patient.name);
  await expect(stepTitle(page)).toHaveText('Subjective');
  await page.goto(`${new URL(page.url()).pathname}?section=objective`);
  await expect(stepTitle(page)).toHaveText('Objective');
  await expect(page.getByLabel('Region')).toHaveValue('knee');
  await page.getByText('Right', { exact: true }).click();

  const measure = (key: string) => page.locator(`[data-testid="measure"][data-measure="${key}"]`);
  const quadriceps = measure('knee.lsi.quadriceps');
  await quadriceps.getByLabel('Involved', { exact: true }).fill('32');
  await quadriceps.getByLabel('Uninvolved', { exact: true }).fill('40');
  await expect(quadriceps.getByTestId('measure-result')).toHaveText(/LSI 80%\s*Not yet/);
  await quadriceps.getByLabel('Involved', { exact: true }).fill('36');
  await expect(quadriceps.getByTestId('measure-result')).toHaveText(/LSI 90%\s*Pass/);
  // A timed hop: lower is better, so the LSI is uninvolved over involved.
  const hop = measure('knee.lsi.6_m_timed_hop');
  await hop.getByLabel('Involved', { exact: true }).fill('2.4');
  await hop.getByLabel('Uninvolved', { exact: true }).fill('2.2');
  await expect(hop.getByTestId('measure-result')).toHaveText(/LSI 92%\s*Pass/);
  const effusion = measure('knee.marker.effusion_grade_0_3');
  await expect(effusion).toContainText('Lower is better');
  await expect(effusion).toContainText('Grade definitions are awaiting the clinic.');
  await effusion.getByText('2', { exact: true }).click();
  await expect(effusion.getByRole('radio', { name: '2' })).toBeChecked();

  await page.getByLabel('Add a test').selectOption('knee.lachman_20_30_degrees_flexion');
  const lachman = page.locator(
    '[data-testid="special-test"][data-test="knee.lachman_20_30_degrees_flexion"]',
  );
  await expect(lachman).toContainText(
    'Positive finding: Increased anterior translation with a soft end-feel',
  );
  await lachman.getByText('Positive', { exact: true }).click();
  await lachman.getByLabel('Interpretation').fill('Soft end-feel, compare with the other side');
  await expect(page.getByText('Saved', { exact: true })).toBeVisible();
  await expect
    .poll(async () => (await savedConsultation(visit.id))?.sections.objective)
    .toMatchObject({
      region: 'knee',
      side: 'right',
      measures: {
        'knee.lsi.quadriceps': { involved: 36, uninvolved: 40 },
        'knee.marker.effusion_grade_0_3': { value: 2 },
      },
      tests: [{ key: 'knee.lachman_20_30_degrees_flexion', result: 'positive' }],
    });

  await page.reload();
  await expect(quadriceps.getByLabel('Involved', { exact: true })).toHaveValue('36');
  await expect(quadriceps.getByTestId('measure-result')).toHaveText(/LSI 90%\s*Pass/);
  await expect(lachman.getByRole('radio', { name: 'Positive' })).toBeChecked();
  await page.goto(`${new URL(page.url()).pathname}?section=sign`);
  await expect(page.getByTestId('sign-section').filter({ hasText: 'Objective' })).toContainText(
    '4 recorded',
  );
});

// CLN-06 done when: condition search from the knowledge base; movement diagnosis; irritability
// suggested; stage from duration; category coded. Decisions (user, 24 October 2026): irritability
// from the worse pain score; the category suggested from SET-12's mapping, changeable; the
// workbook's biomechanical cause beside the movement diagnosis; one knowledge base condition.
test('Assessment takes a knowledge base condition, the suggested irritability and stage, and the category', async ({
  page,
}) => {
  const { physio, patient, visit } = await consultationToday({ submitted: true });
  await submittedAnswers(visit.id, patient.id, {
    region: 'knee',
    sex: 'male',
    pain_now: 4,
    pain_activity: 7,
    duration: 6,
    duration_unit: 'weeks',
  });
  await signInWithCode(page, physio.email, physio.secret);
  await startConsultation(page, patient.name);
  await expect(stepTitle(page)).toHaveText('Subjective');
  await page.goto(`${new URL(page.url()).pathname}?section=sign`);
  const gate = page.getByTestId('sign-gate');
  await expect(gate).toContainText('The working diagnosis needs its four parts');
  await gate.getByRole('link', { name: 'Go to Assessment' }).click();
  await expect(stepTitle(page)).toHaveText('Assessment');

  // The tissue diagnosis from the knowledge base, the knee workbook's conditions first.
  const search = page.getByRole('combobox', { name: 'Tissue diagnosis' });
  await search.fill('patellar tend');
  const options = page.getByRole('option');
  await expect(options.first()).toContainText('Patellar Tendinopathy');
  await expect(options.first()).toContainText('KNE-004 · Knee');
  await search.press('Enter');
  await expect(page.getByTestId('chosen-condition')).toContainText('Patellar Tendinopathy');
  await expect(page.getByTestId('biomechanical-cause').first()).toContainText(
    'From the Knee workbook:',
  );
  await page.getByLabel('Movement diagnosis').fill('Quad dominance with poor hip control');

  // Suggested, never chosen: the worse score is 7 with activity, 6 weeks is Subacute.
  const irritability = page.getByTestId('irritability');
  await expect(irritability).toContainText('Suggested from pain: worst 7/10 (pain with activity)');
  await expect(irritability.getByRole('radio', { name: /High.*Suggested/ })).toBeVisible();
  await expect(irritability.getByRole('radio', { checked: true })).toHaveCount(0);
  await irritability.getByText('Moderate', { exact: true }).click();
  const stage = page.getByTestId('stage');
  await expect(stage).toContainText('Suggested from duration: 6 weeks');
  await expect(stage.getByRole('radio', { name: /Subacute.*Suggested/ })).toBeVisible();
  await expect(stage.getByRole('radio', { checked: true })).toHaveCount(0);
  await stage.locator('label').filter({ hasText: 'Subacute' }).click();

  // The category suggested from the condition (SET-12's draft mapping); the clinician changes it.
  const category = page.getByLabel('Diagnosis category');
  await expect(category).toHaveValue('knee_others');
  await expect(page.getByTestId('category-hint')).toHaveText(
    'Suggested from the condition. Change it if another fits better.',
  );
  await category.selectOption({ label: 'Knee - PFPS' });
  await expect(page.getByTestId('category-hint')).toHaveText(
    'Suggested from the condition: Knee- Others.',
  );
  await expect(page.getByLabel('Provisional diagnosis')).toBeChecked();
  await expect(page.getByText('Saved', { exact: true })).toBeVisible();
  await expect
    .poll(async () => (await savedConsultation(visit.id))?.sections.assessment)
    .toMatchObject({
      conditionId: 'KNE-004',
      movement: 'Quad dominance with poor hip control',
      irritability: 'moderate',
      stage: 'subacute',
      categoryCode: 'knee_pfps',
      provisional: true,
    });

  await page.reload();
  await expect(page.getByTestId('chosen-condition')).toContainText('Patellar Tendinopathy');
  await expect(irritability.getByRole('radio', { name: /Moderate/ })).toBeChecked();
  await expect(stage.getByRole('radio', { name: /Subacute/ })).toBeChecked();
  await expect(page.getByLabel('Diagnosis category')).toHaveValue('knee_pfps');
  // Change keeps the condition until another is chosen.
  await page.getByRole('button', { name: 'Change' }).click();
  await page.getByRole('combobox', { name: 'Tissue diagnosis' }).fill('no such condition');
  await expect(page.getByText('No condition matches.')).toBeVisible();
  await page.getByRole('button', { name: 'Keep Patellar Tendinopathy' }).click();
  await expect(page.getByTestId('chosen-condition')).toContainText('Patellar Tendinopathy');
  // Another condition keeps the category the clinician picked over its own suggestion.
  await page.getByRole('button', { name: 'Change' }).click();
  await page.getByRole('combobox', { name: 'Tissue diagnosis' }).fill('it band');
  await page.getByRole('combobox', { name: 'Tissue diagnosis' }).press('Enter');
  await expect(page.getByTestId('chosen-condition')).toContainText('IT Band Syndrome');
  await expect(page.getByLabel('Diagnosis category')).toHaveValue('knee_pfps');
  await page.getByRole('button', { name: 'Change' }).click();
  await page.getByRole('combobox', { name: 'Tissue diagnosis' }).fill('patellar tend');
  await page.getByRole('combobox', { name: 'Tissue diagnosis' }).press('Enter');
  await expect(page.getByTestId('chosen-condition')).toContainText('Patellar Tendinopathy');

  await page.goto(`${new URL(page.url()).pathname}?section=sign`);
  await expect(gate).not.toContainText('working diagnosis needs');
  await expect(page.getByTestId('sign-section').filter({ hasText: 'Assessment' })).toContainText(
    '4 of 4 parts',
  );
});

// CLN-07 done when: goals, interventions, modalities with precaution warnings, frequency, home
// programme, reviews, questionnaires, treating physio. Decisions (user, 24 October 2026): precaution
// links drafted from the client's documents; a reason to keep a warned modality, signing waits for
// it; home programme typed for now; questionnaires suggested from the diagnosis.
test('Plan warns about a modality against the patient’s precautions and keeps the whole plan', async ({
  page,
}) => {
  // SET-07: an exercise in the library, to add from it.
  const fromLibrary = `E2E Wall sit ${crypto.randomUUID().slice(0, 8)}`;
  const libraryId = await libraryExercise(fromLibrary, '3 × 30 s');
  libraryExercises.push(libraryId);
  const { physio, patient, visit } = await consultationToday({ submitted: true });
  await submittedAnswers(visit.id, patient.id, {
    region: 'knee',
    sex: 'female',
    goals: 'Run 10 km again',
    health_conditions: ['pregnancy', 'bleeding'],
  });
  await signInWithCode(page, physio.email, physio.secret);
  await startConsultation(page, patient.name);
  await expect(stepTitle(page)).toHaveText('Subjective');
  const path = new URL(page.url()).pathname;
  await page.goto(`${path}?section=assessment`);
  await page.getByRole('combobox', { name: 'Tissue diagnosis' }).fill('patellar tend');
  await page.getByRole('combobox', { name: 'Tissue diagnosis' }).press('Enter');
  await expect(page.getByTestId('chosen-condition')).toContainText('Patellar Tendinopathy');
  await page.getByRole('link', { name: 'Next' }).click();
  await expect(stepTitle(page)).toHaveText('Plan');

  // Goals, the patient's own first.
  await expect(page.getByText('Patient’s goals:')).toBeVisible();
  await page.getByRole('button', { name: 'Add as a goal' }).click();
  await expect(page.getByLabel('Goal 1', { exact: true })).toHaveValue('Run 10 km again');
  await expect(page.getByTestId('goal').first().getByLabel('Patient’s goal')).toBeChecked();
  await page.getByRole('button', { name: 'Add a goal' }).click();
  await page.getByLabel('Goal 2', { exact: true }).fill('Full squat without pain');
  await page.getByRole('checkbox', { name: 'Exercise', exact: true }).check();

  // Radial shockwave against pregnancy and a bleeding disorder.
  const shockwave = page.locator('[data-testid="modality"][data-modality="radial_shockwave"]');
  await shockwave.getByLabel('Radial Shockwave (RSW)').check();
  const warning = shockwave.getByTestId('modality-warning');
  await expect(warning).toContainText('Patient ticked: Pregnancy / breastfeeding');
  await expect(warning).toContainText('Patient ticked: Bleeding disorder or blood thinners');
  await expect(warning).toContainText('Awaiting clinical sign-off.');
  await expect(page.getByText('Saved', { exact: true })).toBeVisible();
  await page.goto(`${path}?section=sign`);
  const gate = page.getByTestId('sign-gate');
  await expect(gate).toContainText(
    'Give a reason for each modality kept despite a precaution: Radial Shockwave (RSW).',
  );
  await gate.getByRole('link', { name: 'Go to Plan' }).click();
  await expect(stepTitle(page)).toHaveText('Plan');
  await warning.getByLabel('Reason to keep it').fill('Low energy, away from the abdomen');

  // Frequency, home programme, review, questionnaires, treating physio.
  await page.getByLabel('Sessions a week').fill('2');
  await page.getByLabel('Weeks', { exact: true }).fill('6');
  await page.getByRole('button', { name: 'Add an exercise' }).click();
  const exercise = page.getByTestId('exercise').first();
  await exercise.getByLabel('Exercise', { exact: true }).fill('Spanish squat isometric');
  await exercise.getByLabel('Dose', { exact: true }).fill('5 x 45 s, daily');
  // SET-07: one from the library, with its default dose.
  await page.getByLabel('From the exercise library').selectOption(libraryId);
  await page.getByRole('button', { name: 'Add from library' }).click();
  const picked = page.getByTestId('exercise').nth(1);
  await expect(picked.getByLabel('Exercise', { exact: true })).toHaveValue(fromLibrary);
  await expect(picked.getByLabel('Dose', { exact: true })).toHaveValue('3 × 30 s');
  await expect(picked.getByTestId('from-library')).toHaveText('From the library');
  // Renamed, it is no longer that exercise, nor its video.
  await page.getByLabel('From the exercise library').selectOption(libraryId);
  await page.getByRole('button', { name: 'Add from library' }).click();
  const renamed = page.getByTestId('exercise').nth(2);
  await renamed.getByLabel('Exercise', { exact: true }).fill('Single leg wall sit');
  await expect(renamed.getByTestId('from-library')).toHaveCount(0);
  const review = addDays(istDate(visit.startsAt), 42);
  await expect(page.getByLabel('Review date')).toHaveValue(review);
  const questionnaires = page.getByTestId('questionnaires');
  await expect(questionnaires.getByRole('checkbox', { name: /VISA-P.*Suggested/ })).toBeChecked();
  await expect(questionnaires.getByRole('checkbox', { name: /^KOOS/ })).not.toBeChecked();
  await questionnaires.getByRole('checkbox', { name: /^KOOS/ }).check();
  await expect(page.getByLabel('Treating physio')).toHaveValue(physio.id);
  await expect(page.getByText('Saved', { exact: true })).toBeVisible();
  await expect
    .poll(async () => (await savedConsultation(visit.id))?.sections.plan)
    .toMatchObject({
      goals: [
        { text: 'Run 10 km again', patient: true },
        { text: 'Full squat without pain', patient: false },
      ],
      interventions: ['exercise'],
      modalities: [{ key: 'radial_shockwave', reason: 'Low energy, away from the abdomen' }],
      sessionsPerWeek: 2,
      weeks: 6,
      homeProgramme: [
        { exercise: 'Spanish squat isometric', dose: '5 x 45 s, daily', note: '' },
        { exercise: fromLibrary, dose: '3 × 30 s', note: '', exerciseId: libraryId },
        { exercise: 'Single leg wall sit', dose: '3 × 30 s', note: '' },
      ],
      reviewDate: '',
      questionnaires: ['visa_p', 'koos'],
      treatingPhysioId: '',
    });

  await page.reload();
  await expect(page.getByLabel('Goal 2', { exact: true })).toHaveValue('Full squat without pain');
  await expect(warning.getByLabel('Reason to keep it')).toHaveValue(
    'Low energy, away from the abdomen',
  );
  await expect(page.getByLabel('Sessions a week')).toHaveValue('2');
  await expect(questionnaires.getByRole('checkbox', { name: /^KOOS/ })).toBeChecked();
  await page.goto(`${path}?section=sign`);
  await expect(gate).not.toContainText('Give a reason');
  await expect(page.getByTestId('sign-section').filter({ hasText: 'Plan' })).toContainText(
    '5 of 5 parts',
  );
});

// CLN-09 done when: signing requires the Treats patients tick; later changes only as addenda.
// Decisions (user, 24 October 2026): signing completes the visit; a special test needs a result;
// addenda on the signed consultation by clinicians at its centre; a confirm step. The draft is
// written ready to sign, so the test does not fill every screening item on screen.
test('Sign and finish locks the consultation, completes the visit, and colleagues add addenda', async ({
  page,
  browser,
}) => {
  const { physio, patient, visit } = await consultationToday({ submitted: true });
  await submittedAnswers(visit.id, patient.id, { region: 'knee', sex: 'male' });
  await signInWithCode(page, physio.email, physio.secret);
  await startConsultation(page, patient.name);
  await expect(stepTitle(page)).toHaveText('Subjective');
  const path = new URL(page.url()).pathname;
  const confirmed = Object.fromEntries(
    screeningItems('knee', 'male', {}).map((item) => [
      item.key,
      item.input === 'number' ? 0 : false,
    ]),
  );
  await draftSections(visit.id, {
    screening: { notes: '', confirmed },
    objective: {
      region: 'knee',
      side: 'right',
      measures: { 'knee.lsi.quadriceps': { involved: 32, uninvolved: 40 } },
      tests: [{ key: 'knee.lachman_20_30_degrees_flexion', interpretation: '' }],
    },
    assessment: {
      conditionId: 'KNE-004',
      movement: 'Quad dominance',
      irritability: 'moderate',
      stage: 'subacute',
    },
    plan: { modalities: [{ key: 'laser' }], sessionsPerWeek: 2, weeks: 6 },
  });

  // A special test without a result holds signing back.
  await page.goto(`${path}?section=sign`);
  const gate = page.getByTestId('sign-gate');
  await expect(gate).toContainText(
    'Choose a result for each special test added: Lachman (20-30 degrees flexion).',
  );
  await expect(page.getByRole('button', { name: 'Sign and finish' })).toBeDisabled();
  await gate.getByRole('link', { name: 'Go to Objective' }).click();
  await page
    .locator('[data-testid="special-test"][data-test="knee.lachman_20_30_degrees_flexion"]')
    .getByText('Negative', { exact: true })
    .click();
  await expect(page.getByText('Saved', { exact: true })).toBeVisible();

  // Sign and finish, then confirm.
  await page.goto(`${path}?section=sign`);
  await expect(gate).toContainText('every special test has a result');
  await page.getByRole('button', { name: 'Sign and finish' }).click();
  const confirm = page.getByTestId('sign-confirm');
  await expect(confirm).toContainText(
    'Signing locks this consultation. Later changes are addenda.',
  );
  await confirm.getByRole('button', { name: 'Sign', exact: true }).click();
  await page.waitForURL(/\/app\/my-patients$/);
  await expect
    .poll(() => signedRows(visit.id))
    .toEqual({
      status: 'signed',
      visit: 'completed',
      measures: 2,
      tests: 1,
      diagnoses: 1,
      plans: 1,
      modalities: 1,
    });

  // Locked: read only, signed by the consultant; changes are addenda.
  await page.goto(`${path}?section=assessment`);
  await expect(page.getByTestId('signed-banner')).toContainText(`Signed by ${physio.name} on`);
  await expect(page.getByLabel('Movement diagnosis')).toHaveAttribute('readonly', '');
  await page.goto(`${path}?section=sign`);
  await expect(page.getByRole('button', { name: 'Sign and finish' })).toHaveCount(0);
  await page.getByLabel('Add addendum').fill('Corrected: the right knee is the involved side.');
  await page.getByRole('button', { name: 'Add addendum' }).click();
  const addenda = page.getByTestId('addendum');
  await expect(addenda).toHaveCount(1);
  await expect(addenda.first()).toContainText(physio.name);
  await expect(addenda.first()).toContainText('Corrected: the right knee is the involved side.');

  // A colleague at the centre reads it and adds one too.
  const colleague = await temporaryWithCode('physiotherapist', ['HSR Layout']);
  physios.push(colleague.id);
  const context = await browser.newContext(test.info().project.use);
  const other = await context.newPage();
  await signInWithCode(other, colleague.email, colleague.secret);
  await other.goto(`${path}?section=sign`);
  await expect(other.getByTestId('signed-banner')).toContainText(`Signed by ${physio.name}`);
  await other.getByLabel('Add addendum').fill('Seen by a colleague.');
  await other.getByRole('button', { name: 'Add addendum' }).click();
  await expect(other.getByTestId('addendum')).toHaveCount(2);
  await expect(other.getByTestId('addendum').nth(1)).toContainText(colleague.name);
  await context.close();
});

let database: ReturnType<typeof createDb> | undefined;
const db = () => {
  const url = process.env.DIRECT_DATABASE_URL;
  if (!url) throw new Error('DIRECT_DATABASE_URL is not set.');
  database ??= createDb(url, { max: 1 });
  return database.db;
};
test.afterAll(async () => {
  await database?.close();
});

// ALT-06 done when: signing generates the summary PDF on the centre's letterhead (its message is
// queued for WhatsApp: WA-06 part 2); an addendum generates the next version. Decisions (user, 25
// October 2026): Investigations advised and Referral advised on Plan, printed when filled; the
// coded category stays off; each addendum a new version that prints it.
test('signing generates the consultation summary, and an addendum its next version', async ({
  page,
  browser,
}) => {
  const { physio, patient, visit, desk } = await consultationToday({ submitted: true });
  await submittedAnswers(visit.id, patient.id, { region: 'knee', sex: 'male' });
  await signInWithCode(page, physio.email, physio.secret);
  await startConsultation(page, patient.name);
  await expect(stepTitle(page)).toHaveText('Subjective');
  const path = new URL(page.url()).pathname;
  const confirmed = Object.fromEntries(
    screeningItems('knee', 'male', {}).map((item) => [
      item.key,
      item.input === 'number' ? 0 : false,
    ]),
  );
  await draftSections(visit.id, {
    screening: { notes: '', confirmed },
    objective: {
      region: 'knee',
      side: 'right',
      measures: { 'knee.lsi.quadriceps': { involved: 32, uninvolved: 40 } },
      tests: [],
    },
    assessment: {
      conditionId: 'KNE-004',
      movement: 'Quad dominance',
      irritability: 'moderate',
      stage: 'subacute',
    },
    plan: { sessionsPerWeek: 2, weeks: 6 },
  });

  // Plan: the two optional boxes, saved as typed.
  await page.goto(`${path}?section=plan`);
  await page
    .getByLabel(/Investigations advised/)
    .fill('MRI of the right knee if no better in 4 weeks');
  await page.getByLabel(/Referral advised/).fill('Orthopaedic opinion if the knee locks');
  await expect(page.getByText('Saved', { exact: true })).toBeVisible();
  await expect(
    page.getByText('Printed on the patient’s summary when filled.', { exact: false }).first(),
  ).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: test.info().outputPath('plan-advice.png'), fullPage: true });

  // Sign; the queue (run here as the scheduler would) makes version 1.
  await page.goto(`${path}?section=sign`);
  await page.getByRole('button', { name: 'Sign and finish' }).click();
  await page.getByTestId('sign-confirm').getByRole('button', { name: 'Sign', exact: true }).click();
  await page.waitForURL(/\/app\/my-patients$/);
  const documents = page.getByTestId('patient-documents');
  await tickUntil(page.request, async () => {
    await page.goto(`/app/patients/${patient.id}?tab=documents`);
    await expect(documents.getByTestId('patient-document')).toHaveCount(1, { timeout: 1_000 });
  });
  await expect(documents).toContainText('Consultation summary');
  await expect(documents).toContainText('Version 1 ·');
  const first =
    (await documents.getByRole('link', { name: 'Open PDF' }).getAttribute('href')) ?? '';
  const opened = await page.request.get(first);
  expect(opened.status()).toBe(200);
  expect(opened.headers()['content-type']).toBe('application/pdf');
  expect(opened.headers()['content-disposition']).toBe(
    'inline; filename="consultation-summary-v1.pdf"',
  );
  expect((await opened.body()).toString('latin1')).toMatch(/\/BaseFont \/[A-Z]{6}\+IBMPlexSans/);

  // WA-06 part 2: the bundled WhatsApp message carries this PDF and the patient's links (Not sent
  // here, without a WhatsApp token). Its job may have run before the PDF was made and be waiting
  // for its retry: brought forward to now.
  await withActor(db(), systemActor('tests'), (tx) =>
    tx
      .update(job)
      .set({ runAt: sql`now()` })
      .where(and(eq(job.kind, 'whatsapp.consultation_summary'), eq(job.status, 'queued'))),
  );
  let bundled: typeof message.$inferSelect | undefined;
  await tickUntil(page.request, async () => {
    [bundled] = await db()
      .select()
      .from(message)
      .where(
        and(eq(message.patientId, patient.id), eq(message.templateKey, 'consultation_summary')),
      );
    expect(bundled).toBeTruthy();
  });
  const [pdf] = await db()
    .select({ id: documentRow.id })
    .from(documentRow)
    .where(and(eq(documentRow.patientId, patient.id), eq(documentRow.version, 1)));
  expect(bundled?.variables).toMatchObject({
    document_id: pdf?.id,
    document_name: 'Consultation summary.pdf',
  });
  expect(bundled?.variables.plan_link).toBeTruthy();
  expect(bundled?.variables.feedback_link).toBeTruthy();
  // "Open My plan" opens the patient's plan.
  const phone = await browser.newContext(test.info().project.use);
  const theirs = await phone.newPage();
  await theirs.goto(`/p/${bundled?.variables.plan_link ?? ''}`);
  await expect(theirs.getByRole('region', { name: 'Your exercises' })).toBeVisible();
  expect(
    await theirs.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBe(true);
  await theirs.screenshot({ path: test.info().outputPath('summary-my-plan.png'), fullPage: true });
  await phone.close();
  await withActor(db(), systemActor('tests'), async (tx) => {
    const ids = (
      await tx.select({ id: message.id }).from(message).where(eq(message.patientId, patient.id))
    ).map((row) => row.id);
    if (ids.length === 0) return;
    await tx.delete(job).where(
      inArray(
        job.idempotencyKey,
        ids.map((id) => ['whatsapp.send', id].join(':')),
      ),
    );
    await tx.delete(message).where(inArray(message.id, ids));
  });

  // An addendum: the next version, the first kept under it.
  await page.goto(`${path}?section=sign`);
  await page.getByLabel('Add addendum').fill('Corrected: the right knee is the involved side.');
  await page.getByRole('button', { name: 'Add addendum' }).click();
  await expect(page.getByTestId('addendum')).toHaveCount(1);
  await tickUntil(page.request, async () => {
    await page.goto(`/app/patients/${patient.id}?tab=documents`);
    await expect(documents).toContainText('Version 2 ·', { timeout: 1_000 });
  });
  await expect(documents.getByTestId('patient-document')).toHaveCount(1);
  await expect(documents.getByRole('link', { name: /^Version 1, / })).toHaveAttribute(
    'href',
    first,
  );
  // Running the queue again makes nothing new.
  await runDueJobs(page.request);
  await page.reload();
  await expect(documents.getByRole('link', { name: /^Version \d, / })).toHaveCount(1);
  await page.screenshot({ path: test.info().outputPath('summary-documents.png'), fullPage: true });

  // The front desk opens neither.
  const context = await browser.newContext(test.info().project.use);
  const deskPage = await context.newPage();
  await signIn(deskPage, desk.email);
  expect((await deskPage.request.get(first)).status()).toBe(404);
  await context.close();
});

// CLN-11 and ALT-07 done when: a red flag found in the consultation is recorded in its category;
// every category but Monitor with caution puts the episode On hold and generates the referral
// letter (user decisions, 25 October 2026); the safety advice is queued for the WhatsApp tickets.
test('a red flag found in the consultation holds the episode and generates the referral letter', async ({
  page,
  browser,
}) => {
  const { physio, patient, visit, desk } = await consultationToday({ submitted: true });
  await submittedAnswers(visit.id, patient.id, {
    region: 'knee',
    sex: 'male',
    complaint: 'Thigh pain at night',
  });
  await signInWithCode(page, physio.email, physio.secret);
  await startConsultation(page, patient.name);
  await expect(stepTitle(page)).toHaveText('Subjective');
  const path = new URL(page.url()).pathname;
  await page.goto(`${path}?section=screening`);

  const found = page.getByTestId('red-flag-found');
  await expect(found).toContainText('None recorded.');
  await found.getByRole('button', { name: 'Red flag found' }).click();
  await found.getByRole('radio', { name: /Urgent medical referral/ }).check();
  await found.getByLabel('Red flags found').fill('Night pain and weight loss');
  await found.getByRole('button', { name: 'Record and refer' }).click();
  await expect(found.getByRole('alert')).toContainText('Say where the patient was referred.');
  await found.getByLabel('Referred to').fill('Orthopaedic surgeon');
  await found.getByLabel('Reason').fill('Constant night pain with 5 kg weight loss over 6 weeks.');
  await found.getByLabel('Question for the specialist').fill('Please rule out a bony lesion.');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: test.info().outputPath('red-flag-form.png'), fullPage: true });
  await found.getByRole('button', { name: 'Record and refer' }).click();
  await expect(found.getByTestId('recorded-red-flag')).toHaveCount(1);
  await expect(found).toContainText('Urgent medical referral · Referred to Orthopaedic surgeon');
  await expect.poll(async () => (await pipelineOf(visit.id)).status).toBe('on_hold');

  // The queue makes the letter, on the patient record's Documents tab.
  const documents = page.getByTestId('patient-documents');
  await tickUntil(page.request, async () => {
    await page.goto(`/app/patients/${patient.id}?tab=documents`);
    await expect(documents).toContainText('Referral letter', { timeout: 1_000 });
  });
  const href = (await documents.getByRole('link', { name: 'Open PDF' }).getAttribute('href')) ?? '';
  const opened = await page.request.get(href);
  expect(opened.status()).toBe(200);
  expect(opened.headers()['content-disposition']).toBe('inline; filename="referral-letter-v1.pdf"');

  // The front desk opens none of it.
  const context = await browser.newContext(test.info().project.use);
  const deskPage = await context.newPage();
  await signIn(deskPage, desk.email);
  expect((await deskPage.request.get(href)).status()).toBe(404);
  await context.close();
});

test('Monitor with caution is recorded without holding the episode or a letter', async ({
  page,
}) => {
  const { physio, patient, visit } = await consultationToday({ submitted: true });
  await submittedAnswers(visit.id, patient.id, { region: 'knee', sex: 'male' });
  await signInWithCode(page, physio.email, physio.secret);
  await startConsultation(page, patient.name);
  await expect(stepTitle(page)).toHaveText('Subjective');
  const path = new URL(page.url()).pathname;
  await page.goto(`${path}?section=screening`);
  const found = page.getByTestId('red-flag-found');
  await found.getByRole('button', { name: 'Red flag found' }).click();
  await found.getByRole('radio', { name: /Monitor with caution/ }).check();
  await expect(found.getByLabel('Referred to')).toHaveCount(0);
  await found.getByLabel('Red flags found').fill('Mild night pain');
  await found.getByRole('button', { name: 'Record red flag' }).click();
  await expect(found).toContainText('Monitor with caution · Monitoring');
  expect((await pipelineOf(visit.id)).status).not.toBe('on_hold');
  await runDueJobs(page.request);
  await page.goto(`/app/patients/${patient.id}?tab=documents`);
  await expect(
    page.getByText('Consultation summaries and letters appear here once they are generated.'),
  ).toBeVisible();
});
