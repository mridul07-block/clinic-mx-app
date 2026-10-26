import { expect, test } from '@playwright/test';
import { centreIdByCode, removeCalendarRows, startedAppointment } from './calendar';
import {
  alertTrailOf,
  otherBrowser,
  pipelineOf,
  removePipelineRows,
  saddle,
  submitBackForm,
} from './intake';
import { testLink } from './patient-links';
import { testPatient } from './patients';
import { signIn, signInWithCode, temporaryDesk, temporaryWithCode } from './staff';
import { tickUntil } from './jobs';

// ALT-01 done when: alerts go raised, reviewed, referred, closed; the emergency banner stays until
// a clinician acknowledges it; the front desk sees the non clinical banner. Decisions (user, 23
// October 2026): only clinicians act; the banner shows to everyone at the patient's centre; Refer
// puts the episode On hold; Close needs a written decision. A temporary physio's generated
// patient, checked in a few minutes ago today, submits a back form with a yes to saddle numbness.

const made: string[] = [];
const visits: string[] = [];
test.afterEach(async () => {
  await removePipelineRows(visits.splice(0));
  if (made.length) await removeCalendarRows(made.splice(0));
});

test('an emergency: the desk’s banner, the physio reviews, refers and closes, all audited', async ({
  page,
  browser,
}) => {
  const physio = await temporaryWithCode('physiotherapist', ['HSR Layout']);
  made.push(physio.id);
  const patient = await testPatient();
  const visit = await startedAppointment(physio.id, patient.id, 3, {
    minutes: 5,
    values: { status: 'checked_in', arrivedAt: new Date(), checkedInBy: physio.id },
  });
  visits.push(visit.id);
  const link = await testLink({
    purpose: 'health_form',
    patientId: patient.id,
    appointmentId: visit.id,
  });
  const patientPage = await otherBrowser(browser);
  await submitBackForm(patientPage, link.path, [saddle], ['None of these']);
  await patientPage.context().close();

  // The front desk: who needs a clinician before leaving, and nothing clinical.
  const desk = await temporaryDesk();
  const deskPage = await otherBrowser(browser);
  await signIn(deskPage, desk.email);
  await deskPage.goto(`/app/today?centre=${await centreIdByCode('HSR')}`);
  const deskBanner = deskPage.getByTestId('emergency-banner').filter({ hasText: patient.name });
  await expect(deskBanner).toHaveText(
    `Clinician review needed before ${patient.name} leaves.Open patient`,
  );
  await expect(deskBanner).not.toContainText('cauda');
  await expect(deskBanner).toHaveClass(/bg-danger-strong/);
  expect((await deskBanner.boundingBox())?.width).toBe(deskPage.viewportSize()?.width);

  // The physio: the rule on every page, and one action.
  await signInWithCode(page, physio.email, physio.secret);
  const banner = page.getByTestId('emergency-banner').filter({ hasText: patient.name });
  await expect(banner).toContainText(
    `Emergency: Possible cauda equina syndrome (back) · ${patient.name}`,
  );
  await expect(banner).toContainText('Awaiting clinical sign-off');
  await page.goto('/app/notifications');
  await expect(banner).toBeVisible();
  await banner.getByRole('button', { name: 'I’m reviewing' }).click();
  await expect(banner).toHaveCount(0);
  // Gone from the desk's open screen too, without a reload (the live check).
  await expect(deskBanner).toHaveCount(0);
  await deskPage.context().close();

  // The alert card: refer, which puts the episode On hold, then close with a decision.
  await page.goto('/app/alerts');
  const card = page
    .getByTestId('open-alerts')
    .getByTestId('alert-card')
    .filter({ hasText: patient.name });
  await expect(card).toHaveAttribute('data-status', 'reviewed');
  await expect(card).toContainText(`Reviewed · `);
  await expect(card).toContainText(physio.name);
  await card.getByRole('button', { name: 'Refer' }).click();
  await expect(card.getByRole('alert')).toContainText('Say where the patient was referred.');
  await card.getByLabel('Referred to').fill('Emergency department');
  // ALT-07: the referral letter's reason and question are asked for too.
  await card.getByRole('button', { name: 'Refer' }).click();
  await expect(card.getByRole('alert')).toContainText('Write the reason for the referral.');
  await card.getByLabel('Reason').fill('Saddle numbness reported on the health form.');
  await card.getByLabel('Question for the specialist').fill('Please assess for cauda equina.');
  await card.getByRole('button', { name: 'Refer' }).click();
  await expect(card).toHaveAttribute('data-status', 'referred');
  await expect(card).toContainText('Referred to Emergency department');
  expect((await pipelineOf(visit.id)).status).toBe('on_hold');

  // The queue makes the referral letter, on the patient record's Documents tab.
  await tickUntil(page.request, async () => {
    await page.goto(`/app/patients/${patient.id}?tab=documents`);
    await expect(page.getByTestId('patient-documents')).toContainText('Referral letter', {
      timeout: 1_000,
    });
  });
  const letter =
    (await page
      .getByTestId('patient-documents')
      .getByRole('link', { name: 'Open PDF' })
      .getAttribute('href')) ?? '';
  const opened = await page.request.get(letter);
  expect(opened.status()).toBe(200);
  expect(opened.headers()['content-disposition']).toBe('inline; filename="referral-letter-v1.pdf"');
  await page.goto('/app/alerts');

  await card.getByLabel('Decision').fill('Sent to the emergency department for an MRI.');
  await card.getByRole('button', { name: 'Close with decision' }).click();
  const closed = page
    .getByTestId('closed-alerts')
    .getByTestId('alert-card')
    .filter({ hasText: patient.name });
  await expect(closed).toHaveAttribute('data-status', 'closed');
  await expect(closed).toContainText('Decision: Sent to the emergency department for an MRI.');
  await expect(closed.getByRole('button')).toHaveCount(0);

  expect(await alertTrailOf(visit.id)).toEqual([
    { actor: `staff:${physio.id}`, status: 'reviewed' },
    { actor: `staff:${physio.id}`, status: 'referred' },
    { actor: `staff:${physio.id}`, status: 'closed' },
  ]);
});
