import { expect, test } from '@playwright/test';
import { removeCalendarRows, startedAppointment } from './calendar';
import { signedConsultation } from './consultations';
import { exerciseNamed, fakeMp4, libraryHomeProgramme, retireExercises } from './exercises';
import { removePipelineRows } from './intake';
import { consultationTypeId, submittedWithAlert } from './my-patients';
import { testLink } from './patient-links';
import { testPatient } from './patients';
import { activePlan } from './plan-sheet';
import { signInWithCode, temporarySuperAdmin, temporaryWithCode } from './staff';

// SET-07 done when: exercises with dose defaults and video playable on phones. Recommended
// defaults (30 October 2026): the Super Admin keeps the library, each exercise with a default dose
// and a short MP4 or WebM clip; patients watch the videos of their own plan on My plan, served in
// byte ranges from our domain. Generated names and bytes only.

const physios: string[] = [];
const visits: string[] = [];
const exercises: string[] = [];
test.afterEach(async () => {
  await retireExercises(exercises.splice(0));
  await removePipelineRows(visits.splice(0));
  if (physios.length) await removeCalendarRows(physios.splice(0));
});

test('the Super Admin adds an exercise with its video, and the patient watches it on My plan', async ({
  page,
  browser,
}) => {
  test.slow();
  const name = `E2E Bridge ${crypto.randomUUID().slice(0, 8)}`;
  const admin = await temporarySuperAdmin({ support: false });
  await signInWithCode(page, admin.email, admin.secret);
  await page.goto('/app');
  await page.getByRole('main').getByRole('link', { name: 'Exercise library' }).click();
  await expect(page.getByRole('heading', { name: 'Exercise library' })).toBeVisible();

  const add = page.getByTestId('add-exercise');
  // Not a video: refused, by its bytes.
  await add.getByLabel('Exercise', { exact: true }).fill(name);
  await add.getByLabel('Default dose').fill('3 × 12, daily');
  await add.getByLabel('Video (optional)').setInputFiles({
    name: 'notes.mp4',
    mimeType: 'video/mp4',
    buffer: Buffer.from('These are not video bytes at all.'),
  });
  await add.getByRole('button', { name: 'Add to library' }).click();
  await expect(add).toContainText('Add the video as an MP4 or WebM file.');
  await add.getByLabel('Video (optional)').setInputFiles({
    name: 'bridge.mp4',
    mimeType: 'video/mp4',
    buffer: fakeMp4(20_000),
  });
  await add.getByRole('button', { name: 'Add to library' }).click();
  await expect(page.getByTestId('add-exercise')).toContainText(`Added ${name}.`);
  const id = await exerciseNamed(name);
  exercises.push(id);
  const row = page.locator(`[data-testid="exercise"][data-exercise="${id}"]`);
  await expect(row).toContainText('3 × 12, daily');
  await expect(row.getByLabel(`Video: ${name}`)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: test.info().outputPath('exercise-library.png'), fullPage: true });
  // From our domain, in ranges, as phones' players ask.
  const ranged = await page.request.get(`/app/exercises/${id}/video`, {
    headers: { Range: 'bytes=0-1' },
  });
  expect(ranged.status()).toBe(206);
  expect(ranged.headers()['content-range']).toBe('bytes 0-1/20000');

  // A patient whose plan has it watches it on My plan.
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
  await libraryHomeProgramme(consultationId, {
    exercise: name,
    dose: '3 × 12, daily',
    exerciseId: id,
  });
  const link = await testLink({ purpose: 'my_plan', patientId: patient.id, episodeId });
  const phone = await (await browser.newContext(test.info().project.use)).newPage();
  await phone.goto(link.path);
  const exercise = phone.getByTestId('my-plan-exercise').filter({ hasText: name });
  await exercise.getByText('Watch the video').click();
  await expect(exercise.getByLabel(`Video: ${name}`)).toBeVisible();
  const src = await exercise.getByLabel(`Video: ${name}`).getAttribute('src');
  expect(src).toBe(`${link.path}/exercises/${id}`);
  const watched = await phone.request.get(src ?? '', { headers: { Range: 'bytes=0-' } });
  expect(watched.status()).toBe(206);
  expect(watched.headers()['content-type']).toBe('video/mp4');
  // Another exercise, not in their plan: not found.
  const other = await phone.request.get(`${link.path}/exercises/${crypto.randomUUID()}`);
  expect(other.status()).toBe(404);
  expect(
    await phone.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBe(true);
  await phone.screenshot({ path: test.info().outputPath('my-plan-video.png'), fullPage: true });
  await phone.context().close();
});
