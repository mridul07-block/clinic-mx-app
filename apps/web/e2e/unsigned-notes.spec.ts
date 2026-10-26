import { addDays, istDate } from '@clinic-mx/schemas';
import { expect, test } from '@playwright/test';
import { removeCalendarRows, startedAppointment } from './calendar';
import { tickUntil } from './jobs';
import { consultationTypeId } from './my-patients';
import { testEpisode, testPatient } from './patients';
import { exclusively, signInWithCode, temporaryWithCode } from './staff';
import { draftNote, removeUnsignedNotesFlag, unsignedNotesFlagDueNow } from './tasks';

// CLN-10 done when: unsigned notes are listed to the Centre Manager at 9 PM. Decisions (user, 26
// October 2026): every note started and not signed, any day; one task per centre for its Centre
// Managers, listing visit, physio and number but never the patient; tonight's replaces last
// night's. The job runs here when the test queues it due now.

const physios: string[] = [];
const nights: string[] = [];
test.afterEach(async () => {
  for (const night of nights.splice(0)) await removeUnsignedNotesFlag(night);
  if (physios.length) await removeCalendarRows(physios.splice(0));
});

test('the Centre Manager’s Tasks list the night’s unsigned notes at their centre', async ({
  page,
  request,
}) => {
  const physio = await temporaryWithCode('physiotherapist', ['HSR Layout'], { consultant: true });
  physios.push(physio.id);
  const patient = await testPatient();
  const episodeId = await testEpisode(patient.id, 'active');
  const started = { status: 'in_progress' as const, arrivedAt: new Date(), checkedInBy: physio.id };
  const consultationVisit = await startedAppointment(physio.id, patient.id, 150, {
    minutes: 45,
    values: {
      ...started,
      appointmentTypeId: await consultationTypeId(),
      episodeId,
      startedAt: new Date(),
      startedBy: physio.id,
    },
  });
  await draftNote('consultation', {
    appointmentId: consultationVisit.id,
    episodeId,
    physioId: physio.id,
  });
  const sessionVisit = await startedAppointment(physio.id, patient.id, 60, {
    minutes: 45,
    values: { ...started, episodeId, startedAt: new Date(), startedBy: physio.id },
  });
  await draftNote('session', { appointmentId: sessionVisit.id, episodeId, physioId: physio.id });
  const manager = await temporaryWithCode('centre_manager', ['HSR Layout']);

  // One night at a time: a night's flag replaces the other nights' open tasks.
  await exclusively('e2e unsigned notes flag', async () => {
    // A night of its own far ahead, so no other night's task is this one.
    const night = addDays(istDate(new Date()), 1000 + Math.floor(Math.random() * 5000));
    nights.push(night);
    await unsignedNotesFlagDueNow(night);
    await signInWithCode(page, manager.email, manager.secret);
    const card = page.getByTestId('task-card').filter({ hasText: consultationVisit.number });
    await tickUntil(request, async () => {
      await page.goto('/app/tasks');
      await expect(card).toHaveCount(1, { timeout: 1000 });
    });
    await expect(card).toContainText(/Unsigned notes: \d+ at HSR Layout/);
    const notes = card.getByTestId('unsigned-notes');
    await expect(notes).toContainText(`Consultation · ${physio.name}`);
    await expect(notes).toContainText(consultationVisit.number);
    await expect(notes).toContainText(`Session · ${physio.name}`);
    await expect(notes).toContainText(sessionVisit.number);
    await expect(card).not.toContainText(patient.name);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await page.screenshot({ path: test.info().outputPath('unsigned-notes.png'), fullPage: true });
  });
});
