import { expect, test } from '@playwright/test';
import { removeCalendarRows, startedAppointment } from './calendar';
import { recordViews, signedConsultation } from './consultations';
import { removePipelineRows } from './intake';
import { consultationTypeId, submittedWithAlert } from './my-patients';
import { testPatient } from './patients';
import { physioLanded, signIn, signInWithCode, temporaryDesk, temporaryWithCode } from './staff';

// CLN-12 done when: the patient record shows the summary card, episodes, signed notes, documents
// and alerts. Decisions (user, 24 October 2026): tabs Overview, Notes, Documents and Alerts for
// clinicians, at any centre, each open a record view; addenda on each signed note, at its centre;
// everyone else sees Overview only. Each test has its own temporary consultant at HSR Layout.

const physios: string[] = [];
const visits: string[] = [];
test.afterEach(async () => {
  await removePipelineRows(visits.splice(0));
  if (physios.length) await removeCalendarRows(physios.splice(0));
});

/** A patient with a consultation signed at HSR Layout: a raised alert and a precaution. */
async function signedPatient() {
  const consultant = await temporaryWithCode('physiotherapist', ['HSR Layout'], {
    consultant: true,
  });
  physios.push(consultant.id);
  const patient = await testPatient();
  const visit = await startedAppointment(consultant.id, patient.id, 60, {
    values: { appointmentTypeId: await consultationTypeId() },
  });
  visits.push(visit.id);
  await submittedWithAlert(visit.id, patient.id);
  const { conditionName } = await signedConsultation(visit.id, consultant.id);
  return { consultant, patient, conditionName };
}

test('a physio at another centre reads the summary, signed notes, documents and alerts', async ({
  page,
}) => {
  const { patient, conditionName } = await signedPatient();
  const reader = await temporaryWithCode('physiotherapist', ['Koramangala']);
  await signInWithCode(page, reader.email, reader.secret);
  await physioLanded(page, `/app/patients/${patient.id}`);

  const tabs = page.getByRole('navigation', { name: 'Patient record' });
  await expect(tabs.getByRole('link')).toHaveText([
    'Overview',
    'Notes',
    'Progress',
    'Documents',
    /^Alerts1$/,
  ]);
  await expect(tabs.getByRole('link', { name: 'Overview' })).toHaveAttribute(
    'aria-current',
    'page',
  );
  // Red flags and precautions first, then the signed diagnosis and plan.
  const card = page.getByTestId('summary-card');
  await expect(card.getByTestId('summary-alerts')).toHaveText('1 open red flag alert');
  await expect(card.getByTestId('summary-precautions')).toContainText('Pregnancy');
  await expect(card.getByTestId('summary-diagnosis')).toContainText(conditionName);
  await expect(card.getByTestId('summary-diagnosis')).toContainText('Dynamic valgus on step down');
  await expect(card.getByTestId('summary-plan')).toContainText('Climb stairs without pain');
  await expect(card.getByTestId('summary-plan')).toContainText('2 a week for 6 weeks');
  await expect(card).toContainText('Last signed note');
  await expect.poll(() => recordViews(patient.id, reader.id)).toBeGreaterThan(0);

  await tabs.getByRole('link', { name: 'Notes' }).click();
  await expect(page).toHaveURL(/\?tab=notes$/);
  const note = page.getByTestId('signed-note');
  await expect(note).toHaveCount(1);
  await expect(note).toContainText(conditionName);
  await expect(page.getByTestId('episode')).toContainText('HSR Layout');
  // Read here, added at HSR Layout only.
  await note.getByText('Addenda (0)').click();
  await expect(note.getByText('No addenda.')).toBeVisible();
  await expect(note.getByRole('button', { name: 'Add addendum' })).toHaveCount(0);
  await note.getByRole('link', { name: 'Open note' }).click();
  await expect(page).toHaveURL(/\/app\/consultations\/[0-9a-f-]+$/);
  await expect(page.getByText(/^Signed by Test Temporary Physio/)).toBeVisible();

  await page.goto(`/app/patients/${patient.id}?tab=documents`);
  await expect(page.getByRole('heading', { name: 'Reports' })).toBeVisible();
  await expect(
    page.getByText('Consultation summaries and letters appear here once they are generated.'),
  ).toBeVisible();

  await page.goto(`/app/patients/${patient.id}?tab=alerts`);
  const alert = page.getByTestId('record-alert');
  await expect(alert).toHaveCount(1);
  await expect(alert).toContainText('Test alert');
  await expect(alert).toHaveAttribute('data-status', 'raised');
  // Acted on from its own centre's Alerts list.
  await expect(alert.getByRole('link', { name: 'Open in Alerts' })).toHaveCount(0);
});

test('the consultant adds an addendum from the record’s Notes', async ({ page }) => {
  const { consultant, patient } = await signedPatient();
  await signInWithCode(page, consultant.email, consultant.secret);
  await physioLanded(page, `/app/patients/${patient.id}?tab=notes`);
  const note = page.getByTestId('signed-note');
  await note.getByText('Addenda (0)').click();
  await note.getByRole('textbox', { name: 'Add addendum' }).fill('Pain eased after the visit.');
  await note.getByRole('button', { name: 'Add addendum' }).click();
  await expect(note.getByTestId('addendum')).toContainText('Pain eased after the visit.');
  await expect(note.getByText('Addenda (1)')).toBeVisible();
});

test('the front desk sees the Overview only, without clinical details', async ({ page }) => {
  const { patient } = await signedPatient();
  const desk = await temporaryDesk();
  await signIn(page, desk.email);
  await page.goto(`/app/patients/${patient.id}?tab=notes`);
  await expect(page.getByRole('heading', { name: patient.name })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Patient record' })).toHaveCount(0);
  await expect(page.getByTestId('summary-card')).toHaveCount(0);
  await expect(page.getByTestId('signed-note')).toHaveCount(0);
  await expect(page.getByTestId('episode')).toHaveCount(1);
  await expect.poll(() => recordViews(patient.id, desk.id)).toBe(0);
});
