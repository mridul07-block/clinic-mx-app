import { expect, test } from '@playwright/test';
import { removeCalendarRows, startedAppointment } from './calendar';
import { removePipelineRows } from './intake';
import { checkedIn, consultationTypeId, submittedWithAlert } from './my-patients';
import { testEpisode, testPatient } from './patients';
import { signInWithCode, temporaryDesk, temporaryWithCode } from './staff';

// SCH-14 done when: previous episodes shown; a recurrence opens a linked episode. Recommended
// defaults under the user's standing approval (28 October 2026): the consultant marks the episode
// "Same problem again" in the consultation; the patient record says so on both episodes.

const physios: string[] = [];
const visits: string[] = [];
test.afterEach(async () => {
  await removePipelineRows(visits.splice(0));
  if (physios.length) await removeCalendarRows(physios.splice(0));
});

test('a consultant marks a returning patient’s episode a recurrence of the discharged one', async ({
  page,
}) => {
  test.slow();
  const physio = await temporaryWithCode('physiotherapist', ['HSR Layout'], { consultant: true });
  physios.push(physio.id);
  const patient = await testPatient();
  // Treated before and discharged with goals achieved; back now with a health form submitted.
  await testEpisode(patient.id, 'discharged');
  const visit = await startedAppointment(physio.id, patient.id, 5, {
    minutes: 5,
    values: { appointmentTypeId: await consultationTypeId() },
  });
  visits.push(visit.id);
  const desk = await temporaryDesk();
  await checkedIn(visit.id, desk.id);
  await submittedWithAlert(visit.id, patient.id);

  await signInWithCode(page, physio.email, physio.secret);
  await page.getByRole('button', { name: `Start consultation for ${patient.name}` }).click();
  await expect(page).toHaveURL(/\/app\/consultations\/[0-9a-f-]+$/);
  const panel = page.getByTestId('previous-episodes');
  await expect(panel).toBeVisible();
  const earlier = panel.getByTestId('previous-episode');
  await expect(earlier).toHaveCount(1);
  await expect(earlier).toContainText('Knee');
  await expect(earlier).toContainText('Goals achieved');
  await earlier.getByRole('button', { name: 'Same problem again' }).click();
  await expect(earlier).toHaveAttribute('data-linked', 'yes');
  await expect(earlier.getByTestId('recurrence-of')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: test.info().outputPath('recurrence.png'), fullPage: true });

  // The record says it on both episodes.
  const consultationUrl = page.url();
  await page.getByRole('link', { name: patient.name }).click();
  await page.getByTestId('tab-notes').click();
  await expect(page.getByTestId('recurrence-of').first()).toContainText(
    'Recurrence of: Knee, closed',
  );
  await expect(page.getByTestId('followed-by-recurrence').first()).toBeVisible();

  // And it can be taken back.
  await page.goto(consultationUrl);
  await panel.getByRole('button', { name: 'Not the same problem' }).click();
  await expect(earlier).toHaveAttribute('data-linked', 'no');
});
