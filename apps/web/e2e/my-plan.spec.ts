import { expect, test } from '@playwright/test';
import { removeCalendarRows, startedAppointment } from './calendar';
import { signedConsultation } from './consultations';
import { removePipelineRows } from './intake';
import { consultationTypeId, submittedWithAlert } from './my-patients';
import { testPatient } from './patients';
import { activePlan } from './plan-sheet';
import { signIn, temporaryDesk, temporaryWithCode } from './staff';

// PAT-01, in part, done when: the desk shows the patient their My plan link as a QR on the plan
// sheet, and the link opens a page with the week of the plan, the next visit, the exercises and
// the pain line. Decisions (recommended defaults, user's standing approval of 28 October 2026):
// a desk QR until WhatsApp sends it; "call the clinic" in place of Reschedule; no videos yet.

const DAY_MINUTES = 24 * 60;
const physios: string[] = [];
const visits: string[] = [];
test.afterEach(async () => {
  await removePipelineRows(visits.splice(0));
  if (physios.length) await removeCalendarRows(physios.splice(0));
});

test('the desk shows the My plan QR, and the patient’s link opens their plan', async ({
  page,
  browser,
}) => {
  test.slow();
  const physio = await temporaryWithCode('physiotherapist', ['HSR Layout'], { consultant: true });
  physios.push(physio.id);
  const patient = await testPatient();
  const seen = await startedAppointment(physio.id, patient.id, 60, {
    minutes: 45,
    values: {
      appointmentTypeId: await consultationTypeId(),
      status: 'completed',
      completedAt: new Date(),
    },
  });
  visits.push(seen.id);
  await submittedWithAlert(seen.id, patient.id);
  const { consultationId } = await signedConsultation(seen.id, physio.id);
  const episodeId = await activePlan(consultationId);
  await startedAppointment(physio.id, patient.id, -2 * DAY_MINUTES, {
    exact: true,
    values: { episodeId },
  });

  const desk = await temporaryDesk();
  await signIn(page, desk.email);
  await page.goto(`/app/plans/${episodeId}`);
  const qr = page.getByTestId('my-plan-qr');
  await qr.getByRole('button', { name: 'Show My plan QR' }).click();
  await expect(qr.getByRole('img', { name: /QR code for the patient/ })).toBeVisible();
  const path = (await qr.getByTestId('my-plan-path').textContent())?.trim() ?? '';
  expect(path).toMatch(/^\/p\/[^/]+$/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: test.info().outputPath('my-plan-qr.png'), fullPage: true });

  // Showing it again shows the same working link, not a new one.
  await page.reload();
  await qr.getByRole('button', { name: 'Show My plan QR' }).click();
  await expect(qr.getByTestId('my-plan-path')).toHaveText(path);

  // The patient's phone, signed out.
  const phone = await browser.newContext(test.info().project.use);
  const mine = await phone.newPage();
  await mine.goto(path);
  await expect(mine.getByTestId('my-plan')).toBeVisible();
  await expect(mine.getByTestId('my-plan-week')).toHaveText('Week 1 of 6');
  await expect(mine.getByTestId('my-plan-next')).toContainText(`Session with ${physio.name}`);
  // No Reschedule button until WhatsApp (WA-05); a call, linked when the centre has a phone.
  await expect(mine.getByTestId('my-plan-next')).toContainText('To change it, call the clinic');
  await expect(mine.getByRole('button', { name: /reschedule/i })).toHaveCount(0);
  await expect(mine.getByTestId('my-plan-exercises')).toContainText('Step downs');
  await expect(mine.getByTestId('my-plan-exercises')).toContainText('3 x 10');
  await expect(mine.getByTestId('my-plan-package')).toHaveCount(0);
  await expect(mine.getByTestId('my-plan-pain')).toBeVisible();
  // Nothing priced on the patient's page.
  await expect(mine.locator('main')).not.toContainText('₹');
  expect(await mine.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await mine.screenshot({ path: test.info().outputPath('my-plan.png'), fullPage: true });
  await phone.close();

  // A desk at another centre sees no QR for this episode.
  const elsewhere = await browser.newContext(test.info().project.use);
  const other = await elsewhere.newPage();
  await signIn(other, 'desk.koramangala@clinicmx.test');
  await other.goto(`/app/plans/${episodeId}`);
  await expect(other.getByTestId('no-plan')).toBeVisible();
  await expect(other.getByTestId('my-plan-qr')).toHaveCount(0);
  await elsewhere.close();
});
