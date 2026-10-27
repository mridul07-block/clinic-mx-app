import { addDays, istDate } from '@clinic-mx/schemas';
import { expect, test } from '@playwright/test';
import { removeCalendarRows, startedAppointment } from './calendar';
import { removePipelineRows } from './intake';
import { signInWithCode, temporaryWithCode } from './staff';

// SCH-13 done when: name, mobile, physio, remaining sessions and package expiry entered before
// launch. Decisions (user, 27 October 2026): the Super Admin only; an Active episode and an
// opening package with no bill; numbering from launch; a Session booked for the patient joins the
// episode, so it can start.

const physios: string[] = [];
const visits: string[] = [];
test.afterEach(async () => {
  await removePipelineRows(visits.splice(0));
  if (physios.length) await removeCalendarRows(physios.splice(0));
});

test('the Super Admin enters a patient in treatment, who is then booked and started as usual', async ({
  page,
  browser,
}) => {
  test.slow();
  const admin = await temporaryWithCode('super_admin');
  const physio = await temporaryWithCode('physiotherapist', ['HSR Layout']);
  const other = await temporaryWithCode('physiotherapist', ['HSR Layout']);
  physios.push(physio.id, other.id);
  const suffix = crypto.randomUUID().slice(0, 8);
  const name = `Test Patient ${suffix}`;
  const mobile = `9${String(Math.floor(Math.random() * 1e9)).padStart(9, '0')}`;
  const expiry = addDays(istDate(new Date()), 45);

  await signInWithCode(page, admin.email, admin.secret);
  await page.goto('/app');
  await page.getByRole('link', { name: 'Opening entries' }).click();
  await expect(page.getByTestId('opening-status')).toHaveText('Opening entries are open');
  const form = page.getByTestId('opening-entry-form');
  await form.getByLabel('Name').fill(name);
  await form.getByLabel('Mobile').fill(mobile);
  await form.getByLabel('Centre').selectOption({ label: 'HSR Layout' });
  await form.getByLabel('Physio').selectOption({ label: physio.name });
  await form.getByLabel('Sessions left').fill('150');
  await form.getByLabel('Package expiry').fill(expiry);
  await form.getByRole('button', { name: 'Add opening entry' }).click();
  // Refused in words, with everything typed and chosen kept.
  await expect(form).toContainText('Enter at most 100 sessions left.');
  await expect(form.getByLabel('Physio')).toHaveValue(physio.id);
  await expect(form.getByLabel('Name')).toHaveValue(name);
  await form.getByLabel('Sessions left').fill('6');
  await form.getByRole('button', { name: 'Add opening entry' }).click();
  await expect(page.getByTestId('opening-entry-done')).toContainText(`${name} entered as HSR-`);

  const entry = page.getByTestId('opening-entry').filter({ hasText: name });
  await expect(entry.getByTestId('opening-entry-summary')).toContainText(
    `HSR Layout · ${physio.name} · 6 of 6 sessions left`,
  );
  // A correction while the package is unused.
  await entry.getByText('Correct', { exact: true }).click();
  await entry.getByLabel('Sessions left').fill('8');
  await entry.getByRole('button', { name: 'Save correction' }).click();
  await expect(entry.getByTestId('opening-entry-summary')).toContainText('8 of 8 sessions left');
  // The form still shows the entry's own physio after the save (not the list's first).
  await expect(entry.getByLabel('Physio')).toHaveValue(physio.id);
  // Another physio, then back: each save shows and keeps the one chosen.
  await entry.getByLabel('Physio').selectOption({ label: other.name });
  await entry.getByRole('button', { name: 'Save correction' }).click();
  await expect(entry.getByTestId('opening-entry-summary')).toContainText(other.name);
  await expect(entry.getByLabel('Physio')).toHaveValue(other.id);
  await entry.getByLabel('Physio').selectOption({ label: physio.name });
  await entry.getByRole('button', { name: 'Save correction' }).click();
  await expect(entry.getByTestId('opening-entry-summary')).toContainText(physio.name);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: test.info().outputPath('opening-entries.png'), fullPage: true });

  // The record says so, and the opening package holds the sessions left.
  const patientId = await entry.getAttribute('data-patient');
  if (!patientId) throw new Error('The entry names no patient.');
  await page.goto(`/app/patients/${patientId}`);
  await expect(page.getByTestId('opening-entry-note')).toContainText(
    `In treatment before launch: an opening entry`,
  );
  await expect(page.getByTestId('opening-entry-note')).toContainText(physio.name);
  await expect(page.getByTestId('package-meter')).toContainText('Opening package');

  // A Session booked without its episode joins it, so the physio can start it.
  const session = await startedAppointment(physio.id, patientId, 5, {
    minutes: 45,
    values: { status: 'checked_in', arrivedAt: new Date(), checkedInBy: physio.id },
  });
  visits.push(session.id);
  const clinician = await browser.newContext(test.info().project.use);
  const physioPage = await clinician.newPage();
  await signInWithCode(physioPage, physio.email, physio.secret);
  await physioPage.goto('/app/my-patients');
  const mine = physioPage.locator(`[data-testid="my-patient"][data-appointment="${session.id}"]`);
  await expect(mine.getByTestId('session-label')).toHaveText('Session 1');
  await expect(mine.getByRole('button', { name: `Start session for ${name}` })).toBeVisible();
  await physioPage.screenshot({
    path: test.info().outputPath('opening-my-patients.png'),
    fullPage: true,
  });
  await clinician.close();
});
