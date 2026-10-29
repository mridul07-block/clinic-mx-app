import {
  createDb,
  kbQuestionnaire,
  latestKnowledgeVersion,
  planOfCare,
  questionnaireResult,
  systemActor,
  withActor,
} from '@clinic-mx/db';
import { expect, test } from '@playwright/test';
import { and, eq, inArray } from 'drizzle-orm';
import { completeVisit } from './bills';
import { removeCalendarRows, startedAppointment } from './calendar';
import { signedConsultation } from './consultations';
import { otherBrowser, removePipelineRows } from './intake';
import { consultationTypeId, submittedWithAlert } from './my-patients';
import { testPatient } from './patients';
import { activePlan } from './plan-sheet';
import { exclusively, signIn, signInWithCode, temporaryDesk, temporaryWithCode } from './staff';

// OUT-02 done when: opened by QR on the patient's phone; one question per screen; auto scored; raw
// answers and version stored. Recommended defaults (29 October 2026): the desk shows the plan's
// questionnaires as a QR until WhatsApp; only instruments signed off with items and a licence
// (SET-08) are offered; the Progress tab draws each with its meaningful change band. A generated
// test instrument only, added to the live knowledge base version for the test and removed after.

let database: ReturnType<typeof createDb> | undefined;
const db = () => {
  const url = process.env.DIRECT_DATABASE_URL;
  if (!url) throw new Error('DIRECT_DATABASE_URL is not set.');
  database ??= createDb(url, { max: 1 });
  return database.db;
};
test.afterAll(async () => {
  await database?.close();
});

/** Each project's own instrument, so the phone and desktop runs never share one. */
const instrumentKey = () => ['e2e_test_instrument', test.info().project.name].join('_');
/** The knowledge base spec counts the instruments; never while a test one is in the library. */
const LIBRARY_LOCK = 'e2e questionnaire library';
const physios: string[] = [];
const visits: string[] = [];
const episodes: string[] = [];
test.afterEach(async () => {
  const done = episodes.splice(0);
  await withActor(db(), systemActor('tests'), async (tx) => {
    if (done.length) {
      await tx.delete(questionnaireResult).where(inArray(questionnaireResult.episodeId, done));
    }
    await tx.delete(kbQuestionnaire).where(eq(kbQuestionnaire.key, instrumentKey()));
  });
  await removePipelineRows(visits.splice(0));
  if (physios.length) await removeCalendarRows(physios.splice(0));
});

/** The generated instrument, signed off with a licence in the live version; its version's id. */
async function testInstrument(): Promise<void> {
  await withActor(db(), systemActor('tests'), async (tx) => {
    const live = await latestKnowledgeVersion(tx);
    if (!live) throw new Error('No knowledge base version.');
    // One left by a run that stopped midway goes first.
    await tx.delete(kbQuestionnaire).where(eq(kbQuestionnaire.key, instrumentKey()));
    await tx.insert(kbQuestionnaire).values({
      kbVersionId: live.id,
      key: instrumentKey(),
      name: 'Test instrument',
      useFor: 'End to end tests',
      sort: 999,
      licence: 'free',
      signedOff: true,
      definition: {
        version: 'e2e-1',
        instructions: 'Answer each test question.',
        items: [
          {
            kind: 'choice',
            key: 'a',
            text: 'Test question one',
            options: [0, 1, 2, 3, 4].map((value) => ({
              label: `Test answer ${String(value)}`,
              value,
            })),
          },
          {
            kind: 'scale',
            key: 'b',
            text: 'Test question two',
            min: 0,
            max: 10,
            minLabel: 'Test low',
            maxLabel: 'Test high',
          },
          {
            kind: 'choice',
            key: 'c',
            text: 'Test question three',
            options: [0, 1, 2, 3, 4].map((value) => ({
              label: `Test answer ${String(value)}`,
              value,
            })),
          },
        ],
        scoring: { method: 'percent', maxMissing: 1, invert: false },
        range: { min: 0, max: 100 },
        better: 'higher',
        meaningfulChange: 10,
        source: 'Generated test instrument',
      },
    });
  });
}

test('the patient fills the plan’s questionnaire from the desk’s QR, one question per screen, and it is scored', async ({
  page,
  browser,
}) => {
  test.slow();
  const physio = await temporaryWithCode('physiotherapist', ['HSR Layout'], { consultant: true });
  physios.push(physio.id);
  const patient = await testPatient();
  const seen = await startedAppointment(physio.id, patient.id, 90, {
    minutes: 45,
    values: {
      appointmentTypeId: await consultationTypeId(),
      status: 'checked_in',
      arrivedAt: new Date(),
      checkedInBy: physio.id,
    },
  });
  visits.push(seen.id);
  await submittedWithAlert(seen.id, patient.id);
  const { consultationId } = await signedConsultation(seen.id, physio.id);
  await completeVisit(seen.id);
  const episodeId = await activePlan(consultationId);
  episodes.push(episodeId);
  await exclusively(LIBRARY_LOCK, async () => {
    await testInstrument();
    await withActor(db(), systemActor('tests'), (tx) =>
      tx
        .update(planOfCare)
        .set({ questionnaires: [instrumentKey()] })
        .where(and(eq(planOfCare.episodeId, episodeId))),
    );

    // The desk shows the QR on the plan and payment sheet.
    const desk = await temporaryDesk();
    await signIn(page, desk.email);
    await page.goto(`/app/plans/${episodeId}`);
    const section = page.getByTestId('questionnaires-qr');
    await section.getByRole('button', { name: 'Show questionnaires QR' }).click();
    await expect(section.getByRole('img', { name: /QR code for the patient/ })).toBeVisible();
    const path = (await section.getByTestId('questionnaires-path').textContent())?.trim() ?? '';
    expect(path).toMatch(/^\/p\/[^/]+$/);

    // The patient's phone: the instructions, then one question per screen.
    const phone = await otherBrowser(browser);
    await phone.goto(path);
    const form = phone.getByTestId('questionnaire-form');
    await expect(form.getByRole('heading', { name: 'Test instrument' })).toBeVisible();
    await expect(form.getByTestId('questionnaire-instructions')).toHaveText(
      'Answer each test question.',
    );
    await form.getByRole('button', { name: 'Start' }).click();
    await expect(form.getByTestId('questionnaire-progress')).toHaveText('Question 1 of 3');
    await expect(form.getByTestId('questionnaire-item')).toHaveText('Test question one');
    expect(
      await phone.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await phone.screenshot({
      path: test.info().outputPath('questionnaire-item.png'),
      fullPage: true,
    });
    await form.getByRole('button', { name: 'Test answer 3' }).click();
    await expect(form.getByTestId('questionnaire-progress')).toHaveText('Question 2 of 3');
    await phone.screenshot({
      path: test.info().outputPath('questionnaire-scale.png'),
      fullPage: true,
    });
    await form.getByRole('button', { name: '6', exact: true }).click();
    await expect(form.getByTestId('questionnaire-progress')).toHaveText('Question 3 of 3');
    await form.getByRole('button', { name: 'Skip this question' }).click();
    await expect(form.getByTestId('questionnaire-ready')).toHaveText(
      'You answered 2 of 3 questions.',
    );
    await form.getByRole('button', { name: 'Send' }).click();
    await expect(phone.getByTestId('patient-link-status')).toHaveText(
      'Thank you. Your answers are with your physiotherapist.',
    );
    await phone.context().close();

    // Scored by our server: 3 of 4 and 6 of 10 is 9 of 14 points, 64.3%; the raw answers and both
    // versions kept.
    const [kept] = await db()
      .select({
        score: questionnaireResult.score,
        answered: questionnaireResult.answered,
        missing: questionnaireResult.missing,
        rawAnswers: questionnaireResult.rawAnswers,
        instrumentVersion: questionnaireResult.instrumentVersion,
      })
      .from(questionnaireResult)
      .where(eq(questionnaireResult.episodeId, episodeId));
    expect(kept).toEqual({
      score: 64.3,
      answered: 2,
      missing: 1,
      rawAnswers: { a: { value: 3 }, b: { value: 6 }, c: { value: null } },
      instrumentVersion: 'e2e-1',
    });

    // The physio reads it on the Progress tab.
    const clinician = await otherBrowser(browser);
    await signInWithCode(clinician, physio.email, physio.secret);
    await clinician.goto(`/app/patients/${patient.id}?tab=progress`);
    const line = clinician
      .getByTestId('progress-questionnaire')
      .filter({ hasText: 'Test instrument' });
    await expect(line).toContainText('64.3');
    await expect(line).toContainText('2 of 3');
    await expect(line.getByTestId('line-band')).toBeVisible();
    await clinician.context().close();
  });
});
