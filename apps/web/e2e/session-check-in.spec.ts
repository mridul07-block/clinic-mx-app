import { expect, test } from '@playwright/test';
import { completeVisit, consultantFee } from './bills';
import { centreIdByCode, removeCalendarRows, startedAppointment } from './calendar';
import { recordViews, signedConsultation } from './consultations';
import { removePipelineRows } from './intake';
import { checkedIn, consultationTypeId, submittedWithAlert } from './my-patients';
import { testPatient } from './patients';
import { packageSessionsUsed, plannedModality, proposedPlan, testPackage } from './plan-sheet';
import { restorePrices, snapshotPrices } from './prices';
import { exclusively, signIn, signInWithCode, temporaryDesk, temporaryWithCode } from './staff';

// SES-01 done when: one tap check in shows "Session n of N" and the gate status. Decisions (user,
// 25 October 2026): N is the plan's planned sessions; checked in Session and treadmill visits are
// numbered in order; the desk still checks in, the physio starts only once the gate is met; until
// Part B consent (BIL-03) payment alone gates.
// SES-02 done when: the physio who starts the session sees the summary card of its episode, from
// the signed plan with no AI sheet. Decisions (user, 25 October 2026): a session screen opened by
// Start session and Open session; the phase line waits for OUT-04 (DECISION SES-02); only the
// appointment's physio opens it, the Super Admin reads it.
// SES-03 done when: the physio writes the note on the phone and Close session signs it, completes
// the visit and uses a package session. Decisions (user, 26 October 2026): pain at rest, during
// activity and after; new symptoms need a description and give the consultant a task; treatment
// ticks from the plan; response and next session in one tap.
// CLN-12 follow up: signed session notes join the patient record and change only by addenda.
// Decisions (user, 26 October 2026): listed inline on Notes with consultations; addenda as on a
// consultation (the tick, at the episode's centre or on one's own note), on Notes and on the
// session screen; the card's last signed note is either kind.
// SES-04 done when: "Same as last time" copies the previous note for editing. Decisions (user, 26
// October 2026): the treatment, home programme changes and next session only; confirm before
// replacing what was entered; hidden without an earlier signed note.
// SES-06 done when: an adverse event requires a description and alerts the consultant. Decisions
// (user, 26 October 2026): an optional tick under the response; at Close session the consultant
// and the Clinical Director (the Super Admin role, DECISION SES-06) each get a task.
// SES-08 done when: physios see colleagues' patients in their centres; notes signed by the writer.
// Decisions (user, 26 October 2026): "Colleagues today" on My patients; a colleague's checked in
// session is started to cover it, its note written and signed by the covering physio; the visit
// stays booked with its own physio and says who covered it.
// SES-05 done when: each modality has its parameter fields, and a precaution warns when relevant.
// Decisions (user, 26 October 2026): common fields and shockwave's from SOP 12.3, filled before
// closing; a reason for a modality that warns about one of the patient's precautions; parameters
// carried over, the reason asked again.

const physios: string[] = [];
const visits: string[] = [];
test.afterEach(async () => {
  await removePipelineRows(visits.splice(0));
  if (physios.length) await removeCalendarRows(physios.splice(0));
});

/** A patient whose consultation today is signed, with the plan proposed (2 a week for 6 weeks). */
async function proposedPatient(physioId: string, minutesAgo: number) {
  const patient = await testPatient();
  const visit = await startedAppointment(physioId, patient.id, minutesAgo, {
    minutes: 45,
    values: {
      appointmentTypeId: await consultationTypeId(),
      status: 'checked_in',
      arrivedAt: new Date(),
      checkedInBy: physioId,
    },
  });
  visits.push(visit.id);
  await submittedWithAlert(visit.id, patient.id);
  const { consultationId, conditionName } = await signedConsultation(visit.id, physioId);
  await completeVisit(visit.id);
  await proposedPlan(consultationId);
  return { patient, visit, consultationId, conditionName };
}

test('a paid session checks in as Session 1 of 12 and starts on its summary card; an unpaid one is held at the gate', async ({
  page,
  browser,
}) => {
  test.slow();
  const physio = await temporaryWithCode('physiotherapist', ['HSR Layout'], { consultant: true });
  physios.push(physio.id);
  await consultantFee(physio.id, 'consultation');
  const paid = await proposedPatient(physio.id, 50);
  // SES-05: the plan includes Radial Shockwave, which warns about the patient's pregnancy.
  await plannedModality(paid.consultationId, 'radial_shockwave');
  const unpaid = await proposedPatient(physio.id, 110);
  const desk = await temporaryDesk();
  const hsr = await centreIdByCode('HSR');
  await exclusively('e2e prices', async () => {
    const snapshot = await snapshotPrices();
    try {
      await testPackage({
        name: 'E2E Twelve sessions',
        sessions: 12,
        pricePaise: 10_000_00,
        itemKey: 'rehabilitation_session',
      });
      // The first patient chooses the package and pays: the episode is Active.
      await signIn(page, desk.email);
      await page.goto(`/app/today?centre=${hsr}`);
      await page.getByRole('link', { name: `Plan and payment for ${paid.patient.name}` }).click();
      await expect(page.getByRole('heading', { name: 'Plan and payment' })).toBeVisible();
      const paidEpisode = new URL(page.url()).pathname.split('/').at(-1) ?? '';
      const form = page.getByTestId('plan-choice-form');
      await form.getByRole('radio', { name: /Package: E2E Twelve sessions/ }).check();
      await form.getByRole('button', { name: 'Record choice' }).click();
      const offer = page.getByTestId('bill').filter({ hasText: 'E2E Twelve sessions' });
      await offer.getByRole('radio', { name: 'UPI QR' }).check();
      await offer.getByRole('button', { name: 'Mark paid ₹10,000' }).click();
      await expect(offer.getByTestId('paid')).toContainText('Paid by UPI QR');
      await page.goto(`/app/today?centre=${hsr}`);
      await page.getByRole('link', { name: `Plan and payment for ${unpaid.patient.name}` }).click();
      await expect(page.getByRole('heading', { name: 'Plan and payment' })).toBeVisible();
      const unpaidEpisode = new URL(page.url()).pathname.split('/').at(-1) ?? '';

      // A session for each today; the unpaid patient's is checked in already.
      const paidSession = await startedAppointment(physio.id, paid.patient.id, 170, {
        minutes: 30,
        values: { episodeId: paidEpisode, status: 'booked' },
      });
      const unpaidSession = await startedAppointment(physio.id, unpaid.patient.id, 230, {
        minutes: 30,
        values: { episodeId: unpaidEpisode, status: 'booked' },
      });
      await checkedIn(unpaidSession.id, desk.id);

      // One tap: the desk checks the paid session in and reads Session 1 of 12.
      await page.goto(`/app/today?centre=${hsr}`);
      const drawer = page.getByRole('complementary', { name: 'Check in' });
      await page
        .getByTestId('today-row')
        .filter({ hasText: paid.patient.name })
        .filter({ hasText: 'Session ·' })
        .getByRole('link', { name: `Check in ${paid.patient.name}` })
        .click();
      await expect(drawer.getByText('Part B consent is not checked yet.')).toBeVisible();
      await drawer.getByLabel('I have checked who this is (name and date of birth)').check();
      await drawer.getByRole('button', { name: 'Check in', exact: true }).click();
      await expect(drawer.getByTestId('session-progress')).toHaveText(
        'Session 1 of 12, payment complete',
      );
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true);
      await page.screenshot({ path: test.info().outputPath('session-drawer.png'), fullPage: true });

      // Today: the paid one numbered, the unpaid one held at the gate.
      await page.goto(`/app/today?centre=${hsr}`);
      const rowOf = (name: string) =>
        page.getByTestId('today-row').filter({ hasText: name }).filter({ hasText: 'Session ·' });
      await expect(rowOf(paid.patient.name).getByTestId('session-label')).toHaveText(
        'Session 1 of 12',
      );
      await expect(rowOf(unpaid.patient.name).getByTestId('session-gate')).toHaveText(
        'Gate blocked',
      );

      // The physio starts the paid session; the unpaid one says why it cannot start.
      const clinician = await browser.newContext(test.info().project.use);
      const physioPage = await clinician.newPage();
      await signInWithCode(physioPage, physio.email, physio.secret);
      await physioPage.goto('/app/my-patients');
      const mine = (id: string) =>
        physioPage.locator(`[data-testid="my-patient"][data-appointment="${id}"]`);
      await expect(mine(paidSession.id).getByTestId('session-label')).toHaveText('Session 1 of 12');
      await expect(mine(unpaidSession.id).getByTestId('session-gate')).toHaveText(
        'Gate blocked: Consent and payment are needed before the first session.',
      );
      await expect(mine(unpaidSession.id).getByRole('button')).toHaveCount(0);
      await physioPage.screenshot({
        path: test.info().outputPath('session-my-patients.png'),
        fullPage: true,
      });
      await mine(paidSession.id)
        .getByRole('button', { name: `Start session for ${paid.patient.name}` })
        .click();

      // SES-02: Start session opens the session screen, the episode's summary card first.
      await expect(physioPage.getByRole('heading', { name: 'Session', exact: true })).toBeVisible();
      expect(new URL(physioPage.url()).pathname).toBe(`/app/sessions/${paidSession.id}`);
      await expect(physioPage.getByTestId('session-label')).toHaveText('Session 1 of 12');
      const card = physioPage.getByTestId('summary-card');
      await expect(card.getByTestId('summary-precautions')).toContainText('Pregnancy');
      await expect(card.getByTestId('summary-diagnosis')).toContainText(paid.conditionName);
      await expect(card.getByTestId('summary-diagnosis')).toContainText(
        'Dynamic valgus on step down',
      );
      await expect(card.getByTestId('summary-plan')).toContainText('Climb stairs without pain');
      await expect(card.getByTestId('summary-plan')).toContainText('2 a week for 6 weeks');
      await expect(card.getByTestId('summary-phase')).toHaveText('Phase: not set up yet');
      await expect(card).toContainText('Last signed note');
      await expect(physioPage.getByTestId('session-read-only')).toHaveCount(0);
      expect(await recordViews(paid.patient.id, physio.id)).toBeGreaterThan(0);
      expect(
        await physioPage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true);
      await physioPage.screenshot({
        path: test.info().outputPath('session-screen.png'),
        fullPage: true,
      });

      // While it runs, My patients opens it again.
      await physioPage.goto('/app/my-patients');
      await expect(mine(paidSession.id)).toContainText(/With you since \d\d:\d\d/);
      await mine(paidSession.id)
        .getByRole('link', { name: `Open session for ${paid.patient.name}` })
        .click();
      await expect(physioPage.getByTestId('summary-card')).toBeVisible();
      expect(new URL(physioPage.url()).pathname).toBe(`/app/sessions/${paidSession.id}`);

      // SES-03: the note, its treatment prefilled from the plan; Close waits for what is missing.
      const note = physioPage.getByRole('region', { name: 'Session note' });
      await expect(note.getByRole('checkbox', { name: 'Exercise' })).toBeChecked();
      await expect(note.getByTestId('close-blockers')).toContainText('Answer "Any new symptoms?".');
      await expect(note.getByRole('button', { name: 'Close session' })).toBeDisabled();
      await note.locator('label').filter({ hasText: /^Yes$/ }).click();
      await note.getByLabel('Describe the new symptoms').fill('Tingling in the foot since Sunday');
      await note.getByLabel('What the patient reports').fill('Stairs are easier this week');
      await note.getByLabel('Pain at rest').fill('2');
      await note.getByLabel('Pain during activity').fill('4');
      await note.getByLabel('Pain after treatment').fill('1');
      await note
        .locator('label')
        .filter({ hasText: /^Better$/ })
        .click();
      await note
        .locator('label')
        .filter({ hasText: /^Progress$/ })
        .click();
      await note.getByLabel('Plan for next time').fill('Add step downs');
      // SES-05: shockwave, from the plan, needs its parameters and a reason despite pregnancy.
      const shockwave = note.locator(
        '[data-testid="modality-parameters"][data-modality="radial_shockwave"]',
      );
      await expect(note.getByRole('checkbox', { name: 'Radial Shockwave (RSW)' })).toBeChecked();
      await expect(shockwave).toContainText('Precaution: Pregnancy');
      await expect(note.getByTestId('close-blockers')).toContainText(
        'Fill the parameters for Radial Shockwave (RSW).',
      );
      await expect(note.getByTestId('close-blockers')).toContainText(
        'Give a reason for Radial Shockwave (RSW) despite Pregnancy.',
      );
      await shockwave.getByLabel('Area treated').fill('Patellar tendon');
      await shockwave.getByLabel('Duration').fill('ten');
      await shockwave.getByLabel('Energy flux density').fill('0.12');
      await shockwave.getByLabel('Frequency').fill('8');
      await shockwave.getByLabel('Settings').fill('2000 shocks');
      await expect(note.getByTestId('close-blockers')).toContainText(
        'Fill the parameters for Radial Shockwave (RSW).',
      );
      await shockwave.getByLabel('Duration').fill('10');
      await shockwave
        .getByLabel('Reason it is still given today')
        .fill('Postpartum; cleared by the obstetrician');
      // Session 1 has no earlier note to copy.
      await expect(note.getByTestId('same-as-last-time')).toHaveCount(0);
      await expect(note.getByTestId('close-blockers')).toHaveCount(0);
      await expect(note.getByRole('status')).toHaveText('Saved');
      expect(
        await physioPage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true);
      await physioPage.screenshot({
        path: test.info().outputPath('session-note.png'),
        fullPage: true,
      });

      // Autosaved: a reload keeps it.
      await physioPage.reload();
      await expect(note.getByLabel('Describe the new symptoms')).toHaveValue(
        'Tingling in the foot since Sunday',
      );
      await expect(note.getByLabel('Pain during activity')).toHaveValue('4');

      // Close session signs it, completes the visit and uses one package session.
      await note.getByRole('button', { name: 'Close session' }).click();
      await expect(
        physioPage.getByRole('status').filter({ hasText: 'Session closed.' }),
      ).toBeVisible();
      expect(new URL(physioPage.url()).pathname).toBe('/app/my-patients');
      await expect(mine(paidSession.id)).toContainText('Completed');
      expect(await packageSessionsUsed(paid.patient.id)).toBe(1);
      await physioPage.goto(`/app/sessions/${paidSession.id}`);
      await expect(physioPage.getByTestId('session-signed')).toContainText(
        `Signed by ${physio.name}`,
      );
      await expect(note.getByRole('button', { name: 'Close session' })).toHaveCount(0);
      await expect(note.getByLabel('Describe the new symptoms')).toHaveAttribute('readonly', '');
      await expect(note.getByText('Closing the session gives the consultant a task')).toHaveCount(
        0,
      );

      // Signed, it changes only by addenda: its physio adds one on the session screen.
      await physioPage.getByLabel('Add addendum').fill('Pain at rest was 3, not 2.');
      await physioPage.getByRole('button', { name: 'Add addendum' }).click();
      await expect(physioPage.getByTestId('addendum')).toHaveCount(1);
      await expect(physioPage.getByTestId('addendum')).toContainText('Pain at rest was 3, not 2.');
      await expect(physioPage.getByTestId('addendum')).toContainText(physio.name);

      // New symptoms: the consultant (here the same physio) has a task to review them.
      await physioPage.goto('/app/tasks');
      await expect(
        physioPage
          .getByTestId('task-card')
          .filter({ hasText: 'New symptoms reported in session 1' }),
      ).toHaveCount(1);

      // SES-04: the next session starts with "Same as last time".
      const second = await startedAppointment(physio.id, paid.patient.id, 135, {
        minutes: 20,
        values: { episodeId: paidEpisode, status: 'booked' },
      });
      await checkedIn(second.id, desk.id);
      await physioPage.goto('/app/my-patients');
      await mine(second.id)
        .getByRole('button', { name: `Start session for ${paid.patient.name}` })
        .click();
      await physioPage.waitForURL((url) => url.pathname === `/app/sessions/${second.id}`);
      await expect(physioPage.getByTestId('session-label')).toHaveText('Session 2 of 12');
      const same = note.getByTestId('same-as-last-time');
      const sameButton = same.getByRole('button', { name: /^Same as last time \(session 1, / });
      await expect(sameButton).toBeVisible();
      // Something entered in a section it copies: it asks first.
      await note.getByLabel('Treatment note').fill('Taped the knee');
      await expect(note.getByRole('status')).toHaveText('Saved');
      await sameButton.click();
      await expect(same).toContainText("Replace what you have entered with last time's note?");
      await same.getByRole('button', { name: 'Keep mine' }).click();
      await expect(note.getByLabel('Treatment note')).toHaveValue('Taped the knee');
      await sameButton.click();
      await same.getByRole('button', { name: 'Replace' }).click();
      await expect(same).toContainText('Copied from session 1. Check it before closing.');
      await expect(note.getByLabel('Treatment note')).toHaveValue('');
      await expect(note.getByLabel('Plan for next time')).toHaveValue('Add step downs');
      await expect(note.getByRole('radio', { name: 'Progress' })).toBeChecked();
      await expect(note.getByRole('checkbox', { name: 'Exercise' })).toBeChecked();
      // Today's questions stay unanswered.
      await expect(note.getByLabel('What the patient reports')).toHaveValue('');
      await expect(note.getByTestId('close-blockers')).toContainText('Answer "Any new symptoms?".');
      await expect(note.getByTestId('close-blockers')).toContainText('Set pain at rest.');
      await expect(note.getByTestId('close-blockers')).toContainText('Choose the response.');
      await expect(note.getByRole('status')).toHaveText('Saved');
      expect(
        await physioPage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true);
      await physioPage.screenshot({
        path: test.info().outputPath('session-same-as-last-time.png'),
        fullPage: true,
      });
      await physioPage.reload();
      await expect(note.getByLabel('Plan for next time')).toHaveValue('Add step downs');
      await expect(note.getByRole('radio', { name: 'Progress' })).toBeChecked();

      // SES-06: session 2 closes with an adverse event, which must be described first.
      await note.locator('label').filter({ hasText: /^No$/ }).click();
      await note.getByLabel('Pain at rest').fill('3');
      await note.getByLabel('Pain during activity').fill('6');
      await note.getByLabel('Pain after treatment').fill('4');
      await note
        .locator('label')
        .filter({ hasText: /^Worse$/ })
        .click();
      // SES-05: the parameters came along; the reason is asked again.
      const again = note.locator(
        '[data-testid="modality-parameters"][data-modality="radial_shockwave"]',
      );
      await expect(again.getByLabel('Area treated')).toHaveValue('Patellar tendon');
      await expect(again.getByLabel('Reason it is still given today')).toHaveValue('');
      await again
        .getByLabel('Reason it is still given today')
        .fill('Postpartum; cleared by the obstetrician');
      await note.getByRole('checkbox', { name: 'Adverse event' }).check();
      await expect(note.getByTestId('close-blockers')).toHaveText('Describe the adverse event.');
      await expect(note.getByRole('button', { name: 'Close session' })).toBeDisabled();
      await expect(
        note.getByText(
          'Closing the session gives the consultant and the Clinical Director a task.',
        ),
      ).toBeVisible();
      await note
        .getByLabel('Describe the adverse event')
        .fill('Dizzy after exercise, settled in 10 minutes');
      await expect(note.getByTestId('close-blockers')).toHaveCount(0);
      await expect(note.getByRole('status')).toHaveText('Saved');
      await physioPage.screenshot({
        path: test.info().outputPath('session-adverse-event.png'),
        fullPage: true,
      });
      await note.getByRole('button', { name: 'Close session' }).click();
      await expect(
        physioPage.getByRole('status').filter({ hasText: 'Session closed.' }),
      ).toBeVisible();
      await physioPage.goto('/app/tasks');
      await expect(
        physioPage.getByTestId('task-card').filter({ hasText: 'Adverse event in session 2' }),
      ).toHaveCount(1);

      // The Clinical Director (the Super Admin role) has its own task, and the record shows it.
      const director = await temporaryWithCode('super_admin');
      const directorContext = await browser.newContext(test.info().project.use);
      const directorPage = await directorContext.newPage();
      await signInWithCode(directorPage, director.email, director.secret);
      await directorPage.goto('/app/tasks');
      await expect(
        directorPage
          .getByTestId('task-card')
          .filter({ hasText: 'Adverse event in session 2: Clinical Director review' })
          .filter({ hasText: paid.patient.name }),
      ).toHaveCount(1);
      await directorPage.goto(`/app/patients/${paid.patient.id}?tab=notes`);
      const adverseNote = directorPage
        .getByTestId('signed-note')
        .filter({ hasText: 'Session 2 ·' });
      await expect(adverseNote).toContainText('Worse · Adverse event');
      await adverseNote.getByText('Open note').click();
      await expect(adverseNote.getByTestId('signed-session-note')).toContainText(
        'Dizzy after exercise, settled in 10 minutes',
      );
      await directorContext.close();

      // SES-08: another physio at the centre reads the session screen, read only; the desk is
      // not allowed in.
      const other = await temporaryWithCode('physiotherapist', ['HSR Layout']);
      physios.push(other.id);
      const otherContext = await browser.newContext(test.info().project.use);
      const otherPage = await otherContext.newPage();
      await signInWithCode(otherPage, other.email, other.secret);
      await otherPage.goto(`/app/sessions/${paidSession.id}`);
      await expect(otherPage.getByTestId('summary-card')).toBeVisible();
      await expect(otherPage.getByTestId('session-read-only')).toHaveText(
        `Read only: this is ${physio.name}'s session.`,
      );

      // On the patient record they read session 1's signed note, with the card's last note now
      // session 2, and add an addendum at the episode's centre.
      await otherPage.goto(`/app/patients/${paid.patient.id}`);
      await expect(otherPage.getByTestId('summary-last-note')).toContainText(
        `Last signed note: Session 2,`,
      );
      await expect(otherPage.getByTestId('summary-diagnosis')).toContainText(paid.conditionName);
      await otherPage.goto(`/app/patients/${paid.patient.id}?tab=notes`);
      const sessionNote = otherPage.getByTestId('signed-note').filter({ hasText: 'Session 1 ·' });
      await expect(otherPage.getByTestId('signed-note').first()).toContainText('Session 2 ·');
      await expect(otherPage.getByTestId('signed-note').nth(1)).toContainText('Session 1 ·');
      await expect(sessionNote).toContainText(
        'Pain 2 at rest · 4 during activity · 1 after treatment · Better',
      );
      await sessionNote.getByText('Open note').click();
      const signedNote = sessionNote.getByTestId('signed-session-note');
      await expect(signedNote).toContainText('Yes. Tingling in the foot since Sunday');
      await expect(signedNote).toContainText('Stairs are easier this week');
      await expect(signedNote).toContainText('Exercise');
      await expect(signedNote).toContainText('Progress');
      await expect(signedNote).toContainText(
        'Radial Shockwave (RSW): Patellar tendon · 10 min · 0.12 mJ/mm² · 8 Hz · 2000 shocks',
      );
      await sessionNote.getByText('Addenda (1)').click();
      await expect(sessionNote.getByTestId('addendum')).toContainText('Pain at rest was 3, not 2.');
      await sessionNote.getByLabel('Add addendum').fill('Reviewed the foot: no change.');
      await sessionNote.getByRole('button', { name: 'Add addendum' }).click();
      await expect(sessionNote.getByTestId('addendum')).toHaveCount(2);
      await expect(sessionNote.getByTestId('addendum').nth(1)).toContainText(other.name);
      expect(
        await otherPage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true);
      await otherPage.screenshot({
        path: test.info().outputPath('session-on-record.png'),
        fullPage: true,
      });

      // SES-08: session 3, booked with the first physio, is covered by the other one.
      const third = await startedAppointment(physio.id, paid.patient.id, 195, {
        minutes: 20,
        values: { episodeId: paidEpisode, status: 'booked' },
      });
      await checkedIn(third.id, desk.id);
      await otherPage.goto('/app/my-patients');
      const colleague = otherPage.locator(
        `[data-testid="colleague-visit"][data-appointment="${third.id}"]`,
      );
      await expect(colleague).toContainText(`with ${physio.name}`);
      await expect(colleague.getByTestId('session-label')).toHaveText('Session 3 of 12');
      expect(
        await otherPage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true);
      await otherPage.screenshot({
        path: test.info().outputPath('colleagues-today.png'),
        fullPage: true,
      });
      await colleague
        .getByRole('button', { name: `Start session for ${paid.patient.name}` })
        .click();
      await otherPage.waitForURL((url) => url.pathname === `/app/sessions/${third.id}`);
      await expect(otherPage.getByTestId('session-covered')).toHaveText(`Covered by ${other.name}`);
      await expect(otherPage.getByTestId('session-read-only')).toHaveCount(0);
      const covering = otherPage.getByRole('region', { name: 'Session note' });
      await covering.locator('label').filter({ hasText: /^No$/ }).click();
      await covering.getByLabel('Pain at rest').fill('2');
      await covering.getByLabel('Pain during activity').fill('3');
      await covering.getByLabel('Pain after treatment').fill('1');
      await covering
        .locator('label')
        .filter({ hasText: /^Better$/ })
        .click();
      await covering
        .locator('label')
        .filter({ hasText: /^Maintain$/ })
        .click();
      await covering
        .locator('[data-testid="modality-parameters"][data-modality="radial_shockwave"]')
        .getByLabel('Reason it is still given today')
        .fill('Postpartum; cleared by the obstetrician');
      await expect(covering.getByTestId('close-blockers')).toHaveCount(0);
      await expect(covering.getByRole('status')).toHaveText('Saved');
      await covering.getByRole('button', { name: 'Close session' }).click();
      await expect(
        otherPage.getByRole('status').filter({ hasText: 'Session closed.' }),
      ).toBeVisible();
      await otherPage.goto(`/app/sessions/${third.id}`);
      await expect(otherPage.getByTestId('session-signed')).toContainText(
        `Signed by ${other.name}`,
      );
      await otherContext.close();

      // The booked physio's own list says who covered it; their screen is read only.
      await physioPage.goto('/app/my-patients');
      await expect(mine(third.id).getByTestId('covered-by')).toHaveText(`Covered by ${other.name}`);
      await physioPage.goto(`/app/sessions/${third.id}`);
      await expect(physioPage.getByTestId('session-read-only')).toHaveText(
        `Read only: this is ${other.name}'s session.`,
      );
      await expect(physioPage.getByTestId('session-signed')).toContainText(
        `Signed by ${other.name}`,
      );
      await clinician.close();
      await page.goto(`/app/sessions/${paidSession.id}`);
      await expect(
        page.getByRole('heading', { name: 'You do not have access to this page' }),
      ).toBeVisible();
    } finally {
      await restorePrices(snapshot);
    }
  });
});
