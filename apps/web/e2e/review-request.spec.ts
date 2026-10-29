import { centre, createDb, job, systemActor, withActor } from '@clinic-mx/db';
import { expect, test } from '@playwright/test';
import { and, eq } from 'drizzle-orm';
import { removeCalendarRows, startedAppointment } from './calendar';
import { restoreCentres, snapshotCentres } from './centres';
import { signedConsultation } from './consultations';
import { removePipelineRows } from './intake';
import { consultationTypeId, submittedWithAlert } from './my-patients';
import { moveEpisode, testPatient } from './patients';
import { activePlan } from './plan-sheet';
import {
  exclusively,
  signIn,
  signInWithCode,
  temporaryDesk,
  temporarySuperAdmin,
  temporaryWithCode,
} from './staff';

// PAT-09 done when: sent to every discharged patient with their centre's link, never filtered by
// score. Recommended defaults (29 October 2026): each centre's Google review link on its details;
// discharging any episode queues the review request for the next day; until WhatsApp, the desk
// shows the link as a QR on every discharged episode's sheet. Centres change under their lock.

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
test.afterEach(async () => {
  await removePipelineRows(visits.splice(0));
  if (physios.length) await removeCalendarRows(physios.splice(0));
});

const REVIEW_LINK = 'https://g.page/r/TestOnlyReview123/review';

test('every discharged patient gets the centre’s review link; the desk shows it as a QR', async ({
  page,
  browser,
}) => {
  test.slow();
  await exclusively('e2e centres', async () => {
    const snapshot = await snapshotCentres();
    try {
      // The Super Admin keeps the centre's Google review link; another site is refused.
      const admin = await temporarySuperAdmin({ support: false });
      const office = await browser.newContext(test.info().project.use);
      const adminPage = await office.newPage();
      await signInWithCode(adminPage, admin.email, admin.secret);
      await adminPage.goto('/app/centres');
      await adminPage
        .getByTestId('centre')
        .filter({ has: adminPage.getByText('HSR Layout', { exact: true }) })
        .click();
      // The seeded centre has no phone or map link yet; both are needed to save.
      await adminPage.getByLabel('Phone').fill('080 4123 4567');
      await adminPage.getByLabel('Map link').fill('https://maps.app.goo.gl/TestOnly123');
      const field = adminPage.getByLabel('Google review link (optional)');
      await field.fill('https://example.com/review');
      await adminPage.getByRole('button', { name: 'Save centre' }).click();
      await expect(adminPage.getByText('Paste the centre’s Google review link')).toBeVisible();
      await field.fill(REVIEW_LINK);
      await adminPage.getByRole('button', { name: 'Save centre' }).click();
      await expect(adminPage.getByRole('status')).toHaveText('Centre saved.');
      await expect(field).toHaveValue(REVIEW_LINK);
      await office.close();

      // A treated patient discharged as Patient choice, with no feedback at all.
      const physio = await temporaryWithCode('physiotherapist', ['HSR Layout'], {
        consultant: true,
      });
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

      const desk = await temporaryDesk();
      await signIn(page, desk.email);
      await page.goto(`/app/plans/${episodeId}`);
      await expect(page.getByTestId('leave-review-qr')).toHaveCount(0);
      await moveEpisode(episodeId, 'active', ['discharged'], 'patient_choice');

      const queued = await db()
        .select({ runAt: job.runAt })
        .from(job)
        .where(
          and(
            eq(job.kind, 'whatsapp.review_request'),
            eq(job.idempotencyKey, ['whatsapp.review_request', episodeId].join(':')),
          ),
        );
      expect(queued).toHaveLength(1);

      await page.reload();
      const qr = page.getByTestId('leave-review-qr');
      await expect(qr.getByRole('img', { name: /Google review page/ })).toBeVisible();
      await expect(qr.getByTestId('leave-review-link')).toHaveText(REVIEW_LINK);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true);
      await page.screenshot({ path: test.info().outputPath('leave-review.png'), fullPage: true });

      // Without a link yet, the desk is told so.
      await withActor(db(), systemActor('tests'), (tx) =>
        tx.update(centre).set({ reviewLink: null }).where(eq(centre.code, 'HSR')),
      );
      await page.reload();
      await expect(qr.getByTestId('leave-review-none')).toContainText(
        'This centre has no Google review link yet.',
      );
    } finally {
      await restoreCentres(snapshot);
    }
  });
});
