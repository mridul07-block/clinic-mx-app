import { expect, test } from '@playwright/test';
import { testEpisode, testPatient } from './patients';
import { signIn, signInWithCode, temporaryDesk, temporaryWithCode } from './staff';

// SCH-03 done when: all statuses from the PRD with guarded transitions and audit. The machine and
// its guards are unit and database tested; here the patient page lists a patient's episodes with
// their status, region, centre, dates and discharge reason, for the front desk and clinicians.

test('the patient page lists episodes, newest first, with status and discharge reason', async ({
  page,
}) => {
  const patient = await testPatient();
  await testEpisode(patient.id, 'discharged', 'goals_achieved');
  await testEpisode(patient.id, 'active');
  const desk = await temporaryDesk();
  await signIn(page, desk.email);
  await page.goto(`/app/patients/${patient.id}`);
  const episodes = page.getByTestId('episode');
  await expect(episodes).toHaveCount(2);
  await expect(episodes.first()).toContainText('Active');
  await expect(episodes.first()).toContainText('Knee');
  await expect(episodes.first()).toContainText('HSR Layout');
  await expect(episodes.last()).toContainText('Discharged');
  await expect(episodes.last()).toContainText('Goals achieved');
  await expect(episodes.last()).toContainText('closed');
});

test('a patient without an episode says how one opens; a physio reads the same list', async ({
  page,
}) => {
  const patient = await testPatient();
  const physio = await temporaryWithCode('physiotherapist', ['HSR Layout']);
  await signInWithCode(page, physio.email, physio.secret);
  await page.goto(`/app/patients/${patient.id}`);
  await expect(page.getByText('No episodes yet. Booking a consultation opens one.')).toBeVisible();
  await testEpisode(patient.id, 'awaiting_consultation');
  // A clinician reads episodes on the record's Notes (CLN-12).
  await page.goto(`/app/patients/${patient.id}?tab=notes`);
  await expect(page.getByTestId('episode')).toContainText('Awaiting consultation');
});
