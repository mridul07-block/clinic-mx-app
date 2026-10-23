import { istDate } from '@clinic-mx/schemas';
import { expect, test } from '@playwright/test';
import { centreIdByCode, removeCalendarRows, startedAppointment } from './calendar';
import { otherBrowser, pipelineOf, removePipelineRows, saddle, submitBackForm } from './intake';
import { testLink } from './patient-links';
import { testPatient } from './patients';
import { signInWithCode, temporaryDesk, signIn, temporaryWithCode } from './staff';

// INT-10 done when: on submit, the episode is created, red flag rules run, precautions are
// stored, the AI job is queued and the physio is notified. Decisions (user, 23 October 2026): the
// latest knowledge base version's rules run, signed off or not, and say so; the physio is told in
// the app, with an unread count on every page. Each test has its own temporary physio, who signs
// in, and a generated patient's visit, checked in a few minutes ago today.

const made: string[] = [];
const visits: string[] = [];
test.afterEach(async () => {
  await removePipelineRows(visits.splice(0));
  if (made.length) await removeCalendarRows(made.splice(0));
});

async function visitLink() {
  const physio = await temporaryWithCode('physiotherapist', ['HSR Layout']);
  made.push(physio.id);
  const patient = await testPatient();
  const visit = await startedAppointment(physio.id, patient.id, 3, {
    minutes: 5,
    values: { status: 'checked_in', arrivedAt: new Date(), checkedInBy: physio.id },
  });
  test.skip(istDate(visit.startsAt) !== istDate(new Date()), 'Just after midnight in IST.');
  visits.push(visit.id);
  const link = await testLink({
    purpose: 'health_form',
    patientId: patient.id,
    appointmentId: visit.id,
  });
  return { physio, patient, visit, path: link.path };
}

test('a red flag yes: the episode, the emergency alert, precautions, the AI job, and the physio told', async ({
  page,
  browser,
}) => {
  const { physio, patient, visit, path } = await visitLink();
  const patientPage = await otherBrowser(browser);
  await submitBackForm(
    patientPage,
    path,
    [saddle],
    ['Any implant (pacemaker / electronic or metal)', 'Bleeding disorder or blood thinners'],
  );
  await patientPage.context().close();

  const left = await pipelineOf(visit.id);
  expect(left).toMatchObject({
    status: 'awaiting_consultation',
    bodyRegion: 'back',
    precautions: ['bleeding', 'implant'],
    jobs: ['ai.preparation_sheet', 'intake.submitted'],
    told: [
      { staffUserId: physio.id, kind: 'health_form_submitted' },
      { staffUserId: physio.id, kind: 'red_flag_emergency' },
    ],
  });
  expect(left.formEpisode).toBe(left.episodeId);
  expect(left.alerts?.every((alert) => alert.kbVersionId.length > 0)).toBe(true);
  expect(left.alerts?.map(({ kbVersionId: _version, ...alert }) => alert)).toEqual([
    {
      ruleKey: 'back.cauda_equina',
      display: 'emergency',
      status: 'raised',
      signedOff: false,
    },
  ]);

  // The physio sees the count on every page, and the list.
  await signInWithCode(page, physio.email, physio.secret);
  await expect(page.getByTestId('notifications-unread')).toHaveText('2');
  await page.getByTestId('notifications-link').click();
  const list = page.getByTestId('notifications');
  await expect(list.locator('[data-kind="red_flag_emergency"]')).toContainText(
    'Possible cauda equina syndrome (back): Immediate emergency (awaiting clinical sign-off)',
  );
  await expect(list.locator('[data-kind="red_flag_emergency"]')).toContainText(patient.name);
  await expect(list.locator('[data-kind="health_form_submitted"]')).toContainText(
    'Health form submitted',
  );
  await expect(list.locator('[data-unread]')).toHaveCount(2);
  // Opening the list marked them read.
  await page.reload();
  await expect(page.getByTestId('notifications-unread')).toHaveCount(0);
  await expect(list.locator('[data-unread]')).toHaveCount(0);
  await list
    .locator('[data-kind="health_form_submitted"]')
    .getByRole('link', { name: 'Open the visit' })
    .click();
  await expect.poll(() => new URL(page.url()).searchParams.get('appointment')).toBe(visit.id);

  // The desk still sees the visit's form, now Submitted.
  const desk = await temporaryDesk();
  const deskPage = await otherBrowser(browser);
  await signIn(deskPage, desk.email);
  await deskPage.goto(`/app/today?centre=${await centreIdByCode('HSR')}&appointment=${visit.id}`);
  await expect(deskPage.getByRole('complementary', { name: 'Check in' })).toContainText(
    'Submitted',
  );
  await deskPage.context().close();
});

test('all clear: an episode, no alerts or precautions, one notification', async ({ browser }) => {
  const { physio, visit, path } = await visitLink();
  const patientPage = await otherBrowser(browser);
  await submitBackForm(patientPage, path, [], ['None of these']);
  await patientPage.context().close();
  expect(await pipelineOf(visit.id)).toMatchObject({
    status: 'awaiting_consultation',
    alerts: [],
    precautions: [],
    told: [{ staffUserId: physio.id, kind: 'health_form_submitted' }],
  });
});
