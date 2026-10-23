import { istDate } from '@clinic-mx/schemas';
import { expect, test } from '@playwright/test';
import { centreIdByCode, removeCalendarRows, startedAppointment } from './calendar';
import { otherBrowser, removePipelineRows, submitBackForm } from './intake';
import { testPatient } from './patients';
import { signIn, signInWithCode, temporaryDesk, temporaryWithCode } from './staff';

// INT-09 done when: the record shows "entered with help by" and the staff member's name.
// Decisions (user, 23 October 2026): "Fill in with the patient" in the check in drawer records the
// helper and opens the form on that device; the patient still signs Part A; the drawer and the
// physio's "Health form submitted" notification show who helped.

const made: string[] = [];
const visits: string[] = [];
test.afterEach(async () => {
  await removePipelineRows(visits.splice(0));
  if (made.length) await removeCalendarRows(made.splice(0));
});

test('the desk fills the form in with the patient; the drawer and the physio see who helped', async ({
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
  test.skip(istDate(visit.startsAt) !== istDate(new Date()), 'Just after midnight in IST.');
  visits.push(visit.id);

  const desk = await temporaryDesk();
  await signIn(page, desk.email);
  await page.goto(`/app/today?centre=${await centreIdByCode('HSR')}&appointment=${visit.id}`);
  const drawer = page.getByRole('complementary', { name: 'Check in' });
  await expect(drawer.getByTestId('form-assisted')).toHaveCount(0);
  await drawer.getByRole('button', { name: 'Fill in with the patient' }).click();
  await expect(page.getByTestId('check-in-done')).toHaveText(
    'You are helping with the form. Open it with the patient.',
  );
  await expect(drawer.getByTestId('form-assisted')).toHaveText(`Entered with help by ${desk.name}`);
  await expect(drawer.getByRole('button', { name: 'Fill in with the patient' })).toHaveCount(0);
  const open = drawer.getByRole('link', { name: 'Open the form' });
  await expect(open).toHaveAttribute('target', '_blank');
  const path = (await open.getAttribute('href')) ?? '';
  expect(path).toMatch(/^\/p\//);

  // The form, filled in together; the patient still signs Part A.
  const together = await otherBrowser(browser);
  await submitBackForm(together, path, [], ['None of these']);
  await together.context().close();

  await page.reload();
  await expect(drawer.getByTestId('form-status')).toContainText('Submitted');
  await expect(drawer.getByTestId('form-assisted')).toHaveText(`Entered with help by ${desk.name}`);

  // The physio is told who helped.
  const physioPage = await otherBrowser(browser);
  await signInWithCode(physioPage, physio.email, physio.secret);
  await physioPage.goto('/app/notifications');
  await expect(
    physioPage.getByTestId('notifications').locator('[data-kind="health_form_submitted"]'),
  ).toContainText(`Entered with help by ${desk.name}`);
  await physioPage.context().close();
});
