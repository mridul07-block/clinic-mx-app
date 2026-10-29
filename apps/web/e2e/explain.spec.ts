import {
  appointment,
  createDb,
  kbPatientContent,
  staffUser,
  systemActor,
  withActor,
} from '@clinic-mx/db';
import { expect, test } from '@playwright/test';
import { eq, sql } from 'drizzle-orm';
import { removeCalendarRows, startedAppointment } from './calendar';
import { signedConsultation } from './consultations';
import { otherBrowser, removePipelineRows } from './intake';
import { consultationTypeId, submittedWithAlert } from './my-patients';
import { testLink } from './patient-links';
import { testPatient } from './patients';
import { exclusively, signInWithCode, temporaryWithCode } from './staff';

// CLN-08 done when: clinician approved content for the chosen condition, readable by the patient.
// Recommended defaults (29 October 2026): "Explain to patient" on the consultation opens the
// approved content (AI-07) for the condition chosen in the assessment, in large type; never a
// draft. Generated test text only, removed after.

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

/** Removes the condition's test content; approved text is kept by a guard, lifted here. */
async function removeContent(conditionId: string): Promise<void> {
  await withActor(db(), systemActor('tests'), async (tx) => {
    await tx.execute(sql`alter table kb_patient_content disable trigger patient_content_guard`);
    await tx.delete(kbPatientContent).where(eq(kbPatientContent.conditionId, conditionId));
    await tx.execute(sql`alter table kb_patient_content enable trigger patient_content_guard`);
  });
}

/** Content for the condition: a draft, or approved as a consultant who treats patients leaves it. */
async function content(conditionId: string, by: string, approved = true): Promise<void> {
  await withActor(db(), systemActor('tests'), async (tx) => {
    const [live] = await tx.execute<{ id: string }>(
      sql`select c.kb_version_id as id from kb_condition c where c.condition_id = ${conditionId}
        order by (c.kb_version_id = internal.live_kb_version()) desc limit 1`,
    );
    const [row] = await tx
      .insert(kbPatientContent)
      .values({
        conditionId,
        kbVersionId: live?.id ?? '',
        source: 'clinician',
        explanation: approved ? 'Test explanation in plain words.' : 'Test draft words.',
        roadmap: 'Test roadmap.',
        homeAdvice: 'Test home advice.',
        warningSigns: 'Test warning signs.',
      })
      .returning({ id: kbPatientContent.id });
    if (!approved) return;
    await tx
      .update(kbPatientContent)
      .set({ status: 'approved', approvedBy: by, approvedAt: new Date() })
      .where(eq(kbPatientContent.id, row?.id ?? ''));
  });
}

test('Explain to patient and My plan show the approved content for the condition, never a draft', async ({
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
  // The helper's knee condition (the first by ID in the newest version), chosen in the assessment.
  const [knee] = await db().execute<{ condition_id: string }>(sql`
    select c.condition_id from kb_condition c
    where c.home_region = 'knee'
      and c.kb_version_id = (select id from kb_version order by number desc limit 1)
    order by c.condition_id limit 1`);
  const probe = await signedConsultation(seen.id, physio.id, {
    sections: { assessment: { conditionId: knee?.condition_id ?? '' } },
  });
  const { conditionId, conditionName } = probe;
  expect(conditionId).toBe(knee?.condition_id);
  const [admin] = await db()
    .select({ id: staffUser.id })
    .from(staffUser)
    .where(eq(staffUser.email, 'super.admin@clinicmx.test'));

  await exclusively('e2e explain to patient', async () => {
    await removeContent(conditionId);
    try {
      await signInWithCode(page, physio.email, physio.secret);
      await page.goto(`/app/consultations/${probe.consultationId}`);
      await page.getByTestId('explain-link').click();
      await expect(page.getByTestId('explain-condition')).toHaveText(conditionName);
      await expect(page.getByTestId('explain-none')).toContainText(
        'No approved explanation for this condition yet.',
      );

      // A draft is never shown.
      await content(conditionId, admin?.id ?? '', false);
      await page.reload();
      await expect(page.getByTestId('explain-none')).toBeVisible();
      await expect(page.locator('main')).not.toContainText('Test draft words.');
      await removeContent(conditionId);

      await content(conditionId, admin?.id ?? '');
      await page.reload();
      const shown = page.getByTestId('explain-content');
      await expect(shown.getByRole('heading', { name: 'Explanation' })).toBeVisible();
      await expect(shown).toContainText('Test explanation in plain words.');
      await expect(shown).toContainText('Test warning signs.');
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true);
      await page.screenshot({ path: test.info().outputPath('explain.png'), fullPage: true });

      // The patient's My plan: the explanation alone, as "About your condition".
      const [visit] = await db()
        .select({ episodeId: appointment.episodeId })
        .from(appointment)
        .where(eq(appointment.id, seen.id));
      const mine = await testLink({
        purpose: 'my_plan',
        patientId: patient.id,
        episodeId: visit?.episodeId ?? '',
      });
      const phone = await otherBrowser(browser);
      await phone.goto(mine.path);
      const about = phone.getByTestId('my-plan-about');
      await expect(about.getByRole('heading', { name: 'About your condition' })).toBeVisible();
      await expect(about).toContainText('Test explanation in plain words.');
      await expect(about).not.toContainText('Test warning signs.');
      expect(
        await phone.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true);
      await phone.screenshot({ path: test.info().outputPath('my-plan-about.png'), fullPage: true });
      await phone.context().close();
    } finally {
      await removeContent(conditionId);
    }
  });
});
