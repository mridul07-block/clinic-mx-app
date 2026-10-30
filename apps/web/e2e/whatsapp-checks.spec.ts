import {
  centre,
  createDb,
  episode,
  feedback,
  job,
  message,
  patientLink,
  systemActor,
  task,
  whatsappEvent,
  withActor,
} from '@clinic-mx/db';
import { expect, test } from '@playwright/test';
import { and, eq, inArray, or, sql } from 'drizzle-orm';
import { removeCalendarRows, startedAppointment } from './calendar';
import { restoreCentres, snapshotCentres } from './centres';
import { signedConsultation } from './consultations';
import { removePipelineRows } from './intake';
import { tickUntil } from './jobs';
import { consultationTypeId, submittedWithAlert } from './my-patients';
import { testLink } from './patient-links';
import { testPatient } from './patients';
import { activePlan } from './plan-sheet';
import { signedSessionsWithBaseline } from './reassessment';
import { signIn, temporaryDesk, temporaryWithCode } from './staff';
import { postWebhook, webhookBody } from './whatsapp';

// WA-06 senders: the first treatment check goes by WhatsApp once session 1 is signed, and the
// patient's tap on Still sore in WhatsApp is recorded as the check's answer, as on the link page,
// with the physio's task and a thank you. The review request's button opens the centre's Google
// review page. Without a WhatsApp token here, messages are recorded as Not sent; the test stands
// in for Meta. Generated people only; their messages, events, visits and notes are removed.

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

const physios: string[] = [];
const visits: string[] = [];
const phones: string[] = [];
const waIds: string[] = [];
test.afterEach(async () => {
  const numbers = phones.splice(0);
  const wa = waIds.splice(0);
  await withActor(db(), systemActor('tests'), async (tx) => {
    if (numbers.length) {
      const ids = (
        await tx
          .select({ id: message.id })
          .from(message)
          .where(or(inArray(message.toPhone, numbers), inArray(message.fromPhone, numbers)))
      ).map((row) => row.id);
      if (ids.length) {
        await tx.delete(job).where(
          inArray(
            job.idempotencyKey,
            ids.flatMap((id) => [`whatsapp.send:${id}`, `whatsapp.route:${id}`]),
          ),
        );
        await tx.delete(message).where(inArray(message.id, ids));
      }
    }
    for (const id of wa) {
      const events = await tx
        .select({ id: whatsappEvent.id })
        .from(whatsappEvent)
        .where(sql`${whatsappEvent.payload}::text like ${`%${id}%`}`);
      for (const event of events) {
        await tx.delete(job).where(eq(job.idempotencyKey, `whatsapp.event:${event.id}`));
        await tx.delete(whatsappEvent).where(eq(whatsappEvent.id, event.id));
      }
    }
  });
  await removePipelineRows(visits.splice(0));
  if (physios.length) await removeCalendarRows(physios.splice(0));
});

test('the first treatment check goes by WhatsApp, and Still sore tapped there reaches the physio', async ({
  page,
}, testInfo) => {
  test.slow();
  const physio = await temporaryWithCode('physiotherapist', ['HSR Layout'], { consultant: true });
  physios.push(physio.id);
  const patient = await testPatient();
  phones.push(patient.phone);
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
  await signedSessionsWithBaseline({
    physioId: physio.id,
    patientId: patient.id,
    episodeId,
    consultationId,
  });

  // The check is due the day after the visit at 10:00 IST: brought forward to now.
  const checkKey = ['whatsapp.first_treatment_check', episodeId].join(':');
  await withActor(db(), systemActor('tests'), (tx) =>
    tx
      .update(job)
      .set({ runAt: sql`now()` })
      .where(eq(job.idempotencyKey, checkKey)),
  );
  let sent: typeof message.$inferSelect | undefined;
  await tickUntil(page.request, async () => {
    [sent] = await db()
      .select()
      .from(message)
      .where(
        and(eq(message.toPhone, patient.phone), eq(message.templateKey, 'first_treatment_check')),
      );
    expect(sent?.patientLinkId).toBeTruthy();
  });
  expect(sent).toMatchObject({
    patientId: patient.id,
    kind: 'template',
    sourceKey: checkKey,
    variables: { patient_name: patient.name.split(' ')[0] },
  });

  // Meta took it (standing in for the send without a token here), and the patient taps Still sore.
  const ours = `wamid.e2e-${crypto.randomUUID()}`;
  const tapId = `wamid.e2e-${crypto.randomUUID()}`;
  waIds.push(tapId);
  await withActor(db(), systemActor('tests'), (tx) =>
    tx
      .update(message)
      .set({
        status: 'sent',
        waMessageId: ours,
        sentAt: new Date(),
        errorCode: null,
        errorTitle: null,
      })
      .where(eq(message.id, sent?.id ?? '')),
  );
  const tap = webhookBody({
    messages: [
      {
        from: patient.phone.slice(1),
        id: tapId,
        timestamp: String(Math.floor(Date.now() / 1000)),
        type: 'button',
        button: { text: 'Still sore', payload: 'first_treatment_check.still_sore' },
        context: { id: ours },
      },
    ],
  });
  expect((await postWebhook(page.request, tap)).status()).toBe(200);
  await tickUntil(page.request, async () => {
    const answers = await db()
      .select({ answers: feedback.answers })
      .from(feedback)
      .where(and(eq(feedback.episodeId, episodeId), eq(feedback.surveyKey, 'first_treatment')));
    expect(answers).toEqual([{ answers: { since_first_treatment: 'still_sore' } }]);
  });
  const tasks = await db()
    .select({ assignee: task.assigneeStaffUserId, priority: task.priority })
    .from(task)
    .where(and(eq(task.kind, 'review.still_sore'), eq(task.episodeId, episodeId)));
  expect(tasks).toEqual([{ assignee: physio.id, priority: 'high' }]);
  const [thanks] = await db()
    .select({ variables: message.variables })
    .from(message)
    .where(and(eq(message.toPhone, patient.phone), eq(message.templateKey, 'check_answer')));
  expect(thanks?.variables).toEqual({ text: 'Thank you, we have noted your answer.' });

  // The desk sees it answered.
  const desk = await temporaryDesk();
  await signIn(page, desk.email);
  await page.goto(`/app/plans/${episodeId}`);
  const qr = page.getByTestId('first-treatment-check-qr');
  await qr.getByRole('button', { name: 'Show first treatment check QR' }).click();
  await expect(qr.getByTestId('first-treatment-check-received')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({
    path: testInfo.outputPath('whatsapp-check-answered.png'),
    fullPage: true,
  });
});

test('the review request’s link opens the centre’s Google review page', async ({ page }) => {
  const [koramangala] = await db()
    .select({ id: centre.id })
    .from(centre)
    .where(eq(centre.code, 'KOR'));
  if (!koramangala) throw new Error('The seed centres are missing.');
  const patient = await testPatient({ centreCode: 'KOR' });
  const [held] = await withActor(db(), systemActor('tests'), (tx) =>
    tx
      .insert(episode)
      .values({ patientId: patient.id, centreId: koramangala.id })
      .returning({ id: episode.id }),
  );
  if (!held) throw new Error('no episode');
  const link = await testLink({ purpose: 'review', patientId: patient.id, episodeId: held.id });
  const snapshot = await snapshotCentres();
  try {
    const page1 = 'https://g.page/r/e2e-only-review/review';
    await withActor(db(), systemActor('tests'), (tx) =>
      tx.update(centre).set({ reviewLink: page1 }).where(eq(centre.id, koramangala.id)),
    );
    const opened = await page.request.get(link.path, { maxRedirects: 0 });
    expect(opened.status()).toBe(307);
    expect(opened.headers().location).toBe(page1);

    // Without one yet, the patient is told so.
    await withActor(db(), systemActor('tests'), (tx) =>
      tx.update(centre).set({ reviewLink: null }).where(eq(centre.id, koramangala.id)),
    );
    await page.goto(link.path);
    await expect(page.getByText('This clinic has no review page yet.')).toBeVisible();
  } finally {
    await restoreCentres(snapshot);
    await withActor(db(), systemActor('tests'), async (tx) => {
      await tx.delete(patientLink).where(eq(patientLink.id, link.id));
      await tx.delete(episode).where(eq(episode.id, held.id));
    });
  }
});
