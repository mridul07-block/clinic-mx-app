import {
  consultation,
  createDb,
  episode,
  systemActor,
  treatmentSession,
  withActor,
} from '@clinic-mx/db';
import { addDays, istDate, istInstant } from '@clinic-mx/schemas';
import { expect, test, type Page } from '@playwright/test';
import { eq, sql } from 'drizzle-orm';
import { completeVisit, consultantFee } from './bills';
import { centreIdByCode, removeCalendarRows, startedAppointment } from './calendar';
import { signedConsultation } from './consultations';
import { removePipelineRows } from './intake';
import { consultationTypeId, submittedWithAlert } from './my-patients';
import { testPatient } from './patients';
import { proposedPlan } from './plan-sheet';
import { signIn, temporaryDesk, temporaryWithCode } from './staff';

// BIL-10 done when: partial payments create a balance; flag above 3 unpaid sessions. Recommended
// defaults (29 October 2026; payments stay whole, so a balance is the unpaid bills): each session
// paid per session is billed when signed; more than 3 unpaid sessions flags the patient on Today,
// in the check in drawer and on Finance's Unpaid; the flag never stops check in (DECISION #10).

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

const fits = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

/** Sessions on the given past days, each checked in and then signed by the physio. */
async function signedSessions(
  physioId: string,
  patientId: string,
  episodeId: string,
  daysAgo: number[],
): Promise<void> {
  const booked: { id: string }[] = [];
  for (const ago of daysAgo) {
    const day = addDays(istDate(new Date()), -ago);
    booked.push(
      await startedAppointment(physioId, patientId, 0, {
        values: {
          episodeId,
          startsAt: istInstant(day, 600),
          endsAt: istInstant(day, 645),
          status: 'checked_in',
          arrivedAt: istInstant(day, 600),
          checkedInBy: physioId,
        },
      }),
    );
  }
  await withActor(db(), systemActor('tests'), async (tx) => {
    const [version] = await tx.execute<{ id: string }>(
      sql`select id from kb_version order by number desc limit 1`,
    );
    for (const visit of booked) {
      // The database numbers the session and fills its episode from the visit.
      const [opened] = await tx
        .insert(treatmentSession)
        .values({
          appointmentId: visit.id,
          episodeId,
          patientId,
          centreId: sql`(select centre_id from appointment where id = ${visit.id})`,
          physioId,
          number: 1,
          kbVersionId: version?.id ?? '',
        })
        .returning({ id: treatmentSession.id });
      await tx
        .update(treatmentSession)
        .set({
          status: 'signed',
          signedBy: physioId,
          signedAt: new Date(),
          painRest: 2,
          painActivity: 3,
          painAfter: 1,
        })
        .where(eq(treatmentSession.id, opened?.id ?? ''));
    }
  });
}

test('four sessions paid per session are billed when signed; the patient is flagged, and still checks in', async ({
  page,
  browser,
}) => {
  test.slow();
  const physio = await temporaryWithCode('physiotherapist', ['HSR Layout'], { consultant: true });
  physios.push(physio.id);
  await consultantFee(physio.id, 'consultation');
  const patient = await testPatient();
  const seen = await startedAppointment(physio.id, patient.id, 120, {
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
  await proposedPlan(consultationId);

  // The desk records pay per session on the plan and payment sheet.
  const desk = await temporaryDesk();
  await signIn(page, desk.email);
  const today = `/app/today?centre=${await centreIdByCode('HSR')}`;
  await page.goto(today);
  await page.getByRole('link', { name: `Plan and payment for ${patient.name}` }).click();
  await expect(page.getByRole('heading', { name: 'Plan and payment' })).toBeVisible();
  const sheet = page.url();
  const form = page.getByTestId('plan-choice-form');
  await form.getByRole('radio', { name: /Pay per session/ }).check();
  await form.getByRole('button', { name: 'Record choice' }).click();
  await expect(page.getByTestId('current-choice')).toContainText('Pay per session');
  const [chosen] = await db()
    .select({ episodeId: consultation.episodeId })
    .from(consultation)
    .where(eq(consultation.id, consultationId));
  const episodeId = chosen?.episodeId ?? '';
  await withActor(db(), systemActor('tests'), (tx) =>
    tx.update(episode).set({ status: 'active' }).where(eq(episode.id, episodeId)),
  );

  // Three sessions signed: billed, not yet flagged.
  await signedSessions(physio.id, patient.id, episodeId, [12, 9, 6]);
  await startedAppointment(physio.id, patient.id, 30, {
    minutes: 45,
    values: { episodeId, status: 'booked' },
  });
  await page.goto(today);
  // The booked session's row: the one still to check in (the consultation is done).
  const row = page
    .getByTestId('today-row')
    .filter({ has: page.getByRole('link', { name: `Check in ${patient.name}` }) });
  await expect(row).toContainText('Session');
  await expect(row.getByTestId('unpaid-flag')).toHaveCount(0);

  // A fourth: over 3 unpaid sessions, flagged on Today and in the drawer; check in still works.
  await signedSessions(physio.id, patient.id, episodeId, [3]);
  await page.reload();
  await expect(row.getByTestId('unpaid-flag')).toHaveText('Over 3 unpaid sessions');
  await row.getByRole('link', { name: `Check in ${patient.name}` }).click();
  const drawer = page.getByRole('complementary', { name: 'Check in' });
  await expect(drawer.getByTestId('unpaid-balance')).toContainText('Over 3 unpaid sessions');
  await expect(drawer.getByTestId('unpaid-balance')).toContainText('4 unpaid sessions');
  expect(await fits(page)).toBe(true);
  await page.screenshot({ path: test.info().outputPath('drawer-flag.png'), fullPage: true });
  await drawer.getByLabel('I have checked who this is (name and date of birth)').check();
  await drawer.getByRole('button', { name: 'Check in', exact: true }).click();
  await expect(drawer.getByTestId('checked-in')).toContainText('Checked in');

  // The sheet lists each session's bill at the session price, unpaid.
  await page.goto(sheet);
  // Each line is the session price's label and the session's number.
  const sessionBills = page.getByTestId('bill').filter({ hasText: ', session ' });
  await expect(sessionBills).toHaveCount(4);
  await expect(sessionBills.first()).toContainText('Unpaid');

  // Finance: the patient's balance, by OP number, flagged; never the name.
  const context = await browser.newContext(test.info().project.use);
  const money = await context.newPage();
  await signIn(money, 'finance@clinicmx.test');
  await money.goto('/app/finance/unpaid');
  const balance = money.getByTestId('balance-row').filter({ hasText: patient.opNumber });
  await expect(balance).toContainText('Over 3 unpaid sessions');
  await expect(balance).toContainText('HSR Layout');
  await expect(money.getByTestId('balances-summary')).toContainText(
    'A flag never stops booking or check in.',
  );
  await expect(money.locator('main')).not.toContainText(patient.name);
  expect(await fits(money)).toBe(true);
  await money.screenshot({ path: test.info().outputPath('finance-balances.png'), fullPage: true });
  const download = money.waitForEvent('download');
  await money.getByTestId('export-balances').click();
  const { readFile } = await import('node:fs/promises');
  const csv = await readFile(await (await download).path(), 'utf8');
  expect(csv.startsWith('OP number,Centres,Rupees,Unpaid bills,Unpaid sessions,Flagged')).toBe(
    true,
  );
  expect(csv).toContain(`${patient.opNumber},HSR Layout,`);
  expect(csv).not.toContain(patient.name);
  await context.close();
});
