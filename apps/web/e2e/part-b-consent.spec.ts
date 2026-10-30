import { expect, test, type Page } from '@playwright/test';
import { centreIdByCode, removeCalendarRows, startedAppointment } from './calendar';
import { signedConsultation } from './consultations';
import { drawSignature, notUnderAge, otherBrowser, removePipelineRows } from './intake';
import { consultationTypeId, submittedWithAlert } from './my-patients';
import { testPatient } from './patients';
import { plannedModality } from './plan-sheet';
import { signIn, temporaryDesk, temporaryWithCode } from './staff';

// BIL-03 done when: Part B consent pages; general terms always; package terms only with a
// package; one card per planned modality; signature; decline rules from PRD J4.5. Recommended
// defaults (30 October 2026): the desk shows the episode's consent QR on the plan and payment
// sheet; what is agreed is not asked again. Generated test patients only.

const physios: string[] = [];
const visits: string[] = [];
test.afterEach(async () => {
  await removePipelineRows(visits.splice(0));
  if (physios.length) await removeCalendarRows(physios.splice(0));
});

/** A signed plan with Laser and Dry needling; the desk on its plan and payment sheet. */
async function planForConsent(page: Page) {
  const physio = await temporaryWithCode('physiotherapist', ['HSR Layout'], { consultant: true });
  physios.push(physio.id);
  const patient = await testPatient();
  const visit = await startedAppointment(physio.id, patient.id, 50, {
    minutes: 45,
    values: {
      appointmentTypeId: await consultationTypeId(),
      status: 'completed',
      completedAt: new Date(),
    },
  });
  visits.push(visit.id);
  await submittedWithAlert(visit.id, patient.id);
  const { consultationId, conditionName } = await signedConsultation(visit.id, physio.id);
  await plannedModality(consultationId, 'laser');
  await plannedModality(consultationId, 'dry_needling');
  const desk = await temporaryDesk();
  await signIn(page, desk.email);
  await page.goto(`/app/today?centre=${await centreIdByCode('HSR')}`);
  await page.getByRole('link', { name: `Plan and payment for ${patient.name}` }).click();
  await expect(page.getByRole('heading', { name: 'Plan and payment' })).toBeVisible();
  return { patient, conditionName };
}

/** The patient's phone: the consent QR's page. */
async function patientPhone(page: Page, browser: Parameters<typeof otherBrowser>[0]) {
  const section = page.getByTestId('part-b');
  await section.getByRole('button', { name: 'Show Part B consent QR' }).click();
  const path = (await section.getByTestId('part-b-path').textContent())?.trim() ?? '';
  expect(path).toMatch(/^\/p\//);
  const phone = await otherBrowser(browser);
  await phone.goto(path);
  await expect(phone.getByRole('heading', { name: 'Your consent before treatment' })).toBeVisible();
  return phone;
}

const card = (phone: Page, key: string) =>
  phone.locator(`[data-testid="part-b-card"][data-key="${key}"]`);

test('the patient agrees the general terms and Laser, declines Dry needling, and signs', async ({
  page,
  browser,
}) => {
  test.slow();
  const { conditionName } = await planForConsent(page);
  const section = page.getByTestId('part-b');
  await expect(section).toContainText('Needed');
  await expect(section.getByTestId('part-b-modalities')).toContainText('Laser');
  // Nothing clinical for the desk.
  await expect(section).not.toContainText(conditionName);

  const phone = await patientPhone(page, browser);
  // The general terms, no package terms (no package chosen), one card per planned treatment.
  await expect(phone.getByTestId('part-b-card')).toHaveCount(4);
  await expect(card(phone, 'part_b.plan')).toContainText(`(${conditionName})`);
  await expect(card(phone, 'part_b.plan')).toContainText('Laser');
  await expect(card(phone, 'part_b.package_refund')).toHaveCount(0);
  await expect(card(phone, 'part_b.modality.dry_needling')).toContainText(
    'Wording awaited from the clinic',
  );
  expect(
    await phone.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBe(true);

  await notUnderAge(phone);
  // Done before answering: every statement asks.
  await phone.getByRole('button', { name: 'Done' }).click();
  await expect(card(phone, 'part_b.plan')).toContainText('Choose I agree or I do not agree.');
  for (const key of ['part_b.plan', 'part_b.right_to_decline', 'part_b.modality.laser']) {
    await card(phone, key).getByText('I agree', { exact: true }).click();
  }
  await card(phone, 'part_b.modality.dry_needling')
    .getByText('I do not agree', { exact: true })
    .click();
  // Something agreed: it is signed.
  await phone.getByRole('button', { name: 'Done' }).click();
  await expect(phone.getByText('Please sign in the box.')).toBeVisible();
  await drawSignature(phone);
  await phone.screenshot({ path: test.info().outputPath('part-b.png'), fullPage: true });
  await phone.getByRole('button', { name: 'Done' }).click();
  await expect(phone.getByText('the front desk will speak to you about it')).toBeVisible();

  // The desk: complete, Dry needling left out; the declined treatment may be asked again.
  await page.reload();
  await expect(section).toContainText('Complete');
  await expect(section.getByTestId('part-b-modalities')).toContainText(
    /Dry needling\s*declined: leave it out/,
  );
  await expect(section.getByTestId('part-b-modalities')).toContainText(/Laser\s*agreed/);
  await phone.context().close();
});

test('a general term declined means no treatment until asked again', async ({ page, browser }) => {
  test.slow();
  await planForConsent(page);
  const phone = await patientPhone(page, browser);
  await notUnderAge(phone);
  for (const each of await phone.getByTestId('part-b-card').all()) {
    await each.getByText('I do not agree', { exact: true }).click();
  }
  // All declined: nothing to sign.
  await phone.getByRole('button', { name: 'Done' }).click();
  await expect(phone.getByText('the front desk will speak to you about it')).toBeVisible();
  await page.reload();
  const section = page.getByTestId('part-b');
  await expect(section).toContainText('Declined');
  await expect(section.getByTestId('part-b-gate')).toHaveText(
    'Part B consent: a general term was declined. No treatment.',
  );
  // Asked again: a new link, the declined statements only.
  await section.getByRole('button', { name: 'Show Part B consent QR' }).click();
  await expect(section.getByTestId('part-b-path')).toBeVisible();
  await phone.context().close();
});
