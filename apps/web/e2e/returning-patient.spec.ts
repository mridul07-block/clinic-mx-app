import { expect, test, type Page } from '@playwright/test';
import { removeCalendarRows, startedAppointment } from './calendar';
import { earlierForm, reviewOf, signConsent } from './intake';
import { testLink } from './patient-links';
import { testPatient } from './patients';
import { temporaryWithCode } from './staff';

// INT-08 done when: details prefilled with "Has anything changed?" (PRD J2.8). Recommended defaults
// chosen under the user's standing approval, 28 October 2026: after Part A a returning patient
// sees the details of their last submitted form (about you, activity, history) and answers; No
// changes keeps them and goes on to today's problem, Something changed opens them filled in. The
// problem, the warning signs and the health check are asked again. Each test has its own
// temporary physio, a generated patient's earlier form and today's visit, checked in.

const made: string[] = [];
test.afterEach(async () => {
  if (made.length) await removeCalendarRows(made.splice(0));
});

/** A patient who came before: an earlier visit's submitted form, and today's visit and link. */
async function returning() {
  const patient = await testPatient({ sex: 'female' });
  const physio = await temporaryWithCode('physiotherapist', ['HSR Layout']);
  made.push(physio.id);
  const before = await startedAppointment(physio.id, patient.id, 180, {
    minutes: 30,
    values: { status: 'completed', arrivedAt: new Date(), checkedInBy: physio.id },
  });
  const earlier = await earlierForm(before.id, patient.id, {
    sex: 'female',
    occupation: 'Teacher',
    dominant_side: 'left',
    activities: ['running'],
    injuries: 'Ankle sprain 2019',
    // Today's problem and the warning signs are never carried over.
    region: 'knee',
    complaint: 'Pain going down stairs',
    night_pain: true,
  });
  const visit = await startedAppointment(physio.id, patient.id, 3, {
    minutes: 5,
    values: { status: 'checked_in', arrivedAt: new Date(), checkedInBy: physio.id },
  });
  const link = await testLink({
    purpose: 'health_form',
    patientId: patient.id,
    appointmentId: visit.id,
  });
  return { earlier, visit, path: link.path };
}

const question = (page: Page, name: string | RegExp) => page.getByRole('group', { name });
const next = (page: Page) => page.getByRole('button', { name: 'Next' }).click();
const at = (page: Page, screen: string) =>
  expect.poll(() => new URL(page.url()).searchParams.get('screen')).toBe(screen);

test('No changes keeps the details; the problem, warning signs and health check are asked again', async ({
  page,
}) => {
  const { earlier, visit, path } = await returning();
  await page.goto(path);
  await page.getByRole('link', { name: 'Start' }).click();
  await signConsent(page, 'changes');

  const review = page.getByTestId('changes-review');
  await expect(page.getByRole('heading', { name: 'Has anything changed?' })).toBeVisible();
  await expect(review.locator('[data-detail="dominant_side"]')).toContainText('Left');
  await expect(review.locator('[data-detail="activities"]')).toContainText('Running');
  await expect(review.locator('[data-detail="injuries"]')).toContainText('Ankle sprain 2019');
  await expect(review).not.toContainText('Pain going down stairs');
  await expect(review).not.toContainText('Knee');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({
    path: test.info().outputPath('has-anything-changed.png'),
    fullPage: true,
  });

  // Nothing else opens until it is answered.
  await page.goto(`${path}?screen=problem`);
  await at(page, 'changes');

  await page.getByRole('button', { name: 'No changes' }).click();
  await at(page, 'problem');
  // Today's problem starts empty.
  await expect(
    question(page, 'Body region').getByRole('radio', { name: 'Knee' }),
  ).not.toBeChecked();
  await question(page, 'Body region').getByText('Knee', { exact: true }).click();
  await next(page);
  await at(page, 'warning_signs');
  await expect(
    question(page, /severe at night/i).getByRole('radio', { name: 'Yes' }),
  ).not.toBeChecked();
  for (const group of await page.getByRole('group').all()) {
    const no = group.getByText('No', { exact: true });
    if ((await no.count()) > 0 && (await no.isVisible())) await no.click();
  }
  const minutes = page.getByLabel(/how many minutes does it last/);
  if ((await minutes.count()) > 0) await minutes.fill('0');
  await next(page);
  await at(page, 'health_check');
  await question(page, 'Tick any that apply').getByText('None of these').click();
  await next(page);
  // Activity asks today's goals, filled in with the activity.
  await at(page, 'activity');
  await expect(
    question(page, /^Activity/).getByRole('checkbox', { name: 'Running' }),
  ).toBeChecked();
  await expect(page.getByLabel(/Your goals/)).toHaveValue('');
  await next(page);
  await at(page, 'history');
  await expect(page.getByLabel(/Previous injuries/)).toHaveValue('Ankle sprain 2019');
  await next(page);

  await at(page, 'end');
  const changes = page.locator('[data-check="changes"]');
  await expect(changes).toContainText('No changes');
  await expect(page.locator('[data-check="about_you"]')).toContainText('Left');
  await page.getByRole('button', { name: 'Submit' }).click();
  await expect(page.getByTestId('patient-link-status')).toHaveAttribute('data-status', 'used');

  const saved = await reviewOf(visit.id);
  expect(saved).toMatchObject({ carriedFromId: earlier, detailsChanged: false });
  expect(saved?.submittedAt).not.toBeNull();
  expect(saved?.answers).toMatchObject({
    dominant_side: 'left',
    activities: ['running'],
    injuries: 'Ankle sprain 2019',
    region: 'knee',
    health_conditions: ['none'],
  });
  expect(saved?.answers.night_pain).toBe(false);
});

test('Something changed opens the details filled in, to change; the answer can be changed', async ({
  page,
}) => {
  const { visit, path } = await returning();
  await page.goto(path);
  await page.getByRole('link', { name: 'Start' }).click();
  await signConsent(page, 'changes');
  // Back goes to Part A, still signed.
  await page.getByRole('link', { name: 'Back' }).click();
  await at(page, 'consent');
  await page.goto(`${path}?screen=changes`);
  await page.getByRole('button', { name: 'Something changed' }).click();

  await at(page, 'about_you');
  await expect(page.getByTestId('filled-in')).toHaveText(
    'Filled in from your last form. Change anything that is different.',
  );
  const side = question(page, /^Dominant side/);
  await expect(side.getByRole('radio', { name: 'Left' })).toBeChecked();
  await side.getByText('Right', { exact: true }).click();
  // An answer the patient clears is theirs too.
  await expect(page.getByLabel(/Occupation/)).toHaveValue('Teacher');
  await page.getByLabel(/Occupation/).fill('');
  await next(page);
  await at(page, 'problem');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  expect(await reviewOf(visit.id)).toMatchObject({
    detailsChanged: true,
    answers: { dominant_side: 'right' },
  });

  // Back to the review: it says what was answered, and can be answered again.
  await page.goto(`${path}?screen=changes`);
  await expect(page.getByTestId('changes-answered')).toHaveText('You said: Something changed');
  await page.getByRole('button', { name: 'No changes' }).click();
  await at(page, 'problem');
  // The patient's own changes stand over the earlier form, a cleared answer included.
  const saved = await reviewOf(visit.id);
  expect(saved).toMatchObject({
    detailsChanged: false,
    answers: { dominant_side: 'right', injuries: 'Ankle sprain 2019' },
  });
  expect(saved?.answers.occupation).toBeUndefined();
});
