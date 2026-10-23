import {
  appointment,
  auditEvent,
  consentRecord,
  createDb,
  episode,
  intakeResponse,
  job,
  notification,
  patientLink,
  patientReport,
  precaution,
  redFlagAlert,
  systemActor,
  withActor,
} from '@clinic-mx/db';
import { expect, test, type Browser, type Page } from '@playwright/test';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';

// The health form in the database for end to end tests (INT-04): what a visit's form saved and
// who the audit says saved it; and a check in undone, as the desk's Undo does. Generated
// patients only (rule 12).

let database: ReturnType<typeof createDb> | undefined;
const db = () => {
  const url = process.env.DIRECT_DATABASE_URL;
  if (!url) throw new Error('DIRECT_DATABASE_URL is not set.');
  database ??= createDb(url, { max: 1, idleTimeoutSeconds: 1 });
  return database.db;
};

/** A visit's health form as saved, and the actors of its audit rows. */
export async function savedForm(appointmentId: string) {
  const [form] = await db()
    .select({
      id: intakeResponse.id,
      formVersion: intakeResponse.formVersion,
      answers: intakeResponse.answers,
      doneScreens: intakeResponse.doneScreens,
    })
    .from(intakeResponse)
    .where(eq(intakeResponse.appointmentId, appointmentId));
  if (!form) return undefined;
  const audit = await db()
    .select({ actor: auditEvent.actor })
    .from(auditEvent)
    .where(and(eq(auditEvent.entity, 'intake_response'), eq(auditEvent.entityId, form.id)));
  return { ...form, actors: [...new Set(audit.map((a) => a.actor))] };
}

/** Undoes a check in, back to Booked, as the desk's Undo check in does the same day. */
export async function undoCheckInOf(appointmentId: string): Promise<void> {
  await withActor(db(), systemActor('tests'), (tx) =>
    tx
      .update(appointment)
      .set({ status: 'booked', arrivedAt: null, checkedInBy: null })
      .where(eq(appointment.id, appointmentId)),
  );
}

/** A visit's Part A consent records, oldest first (INT-06). */
export function consentOf(appointmentId: string) {
  return db()
    .select({
      statementKey: consentRecord.statementKey,
      accepted: consentRecord.accepted,
      signatureKind: consentRecord.signatureKind,
      signatureFile: consentRecord.signatureFile,
      typedName: consentRecord.typedName,
      signer: consentRecord.signer,
      guardianId: consentRecord.guardianId,
    })
    .from(consentRecord)
    .where(eq(consentRecord.appointmentId, appointmentId))
    .orderBy(asc(consentRecord.createdAt), asc(consentRecord.statementKey));
}

/** A Part A statement's card on the consent screen, by part of its text. */
export const consentCard = (page: Page, text: string) => page.getByRole('group', { name: text });

/** The age question, asked when no date of birth is on file (INT-07). */
export const ageQuestion = (page: Page) =>
  page.getByRole('group', { name: /^Is the patient under/ });

/** Answers the age question No when it is asked: the patient signs. */
export async function notUnderAge(page: Page): Promise<void> {
  // The consent screen first: the question shows with its cards.
  await expect(page.getByText('I agree', { exact: true }).first()).toBeVisible();
  if (await ageQuestion(page).isVisible()) {
    await ageQuestion(page).getByText('No', { exact: true }).click();
  }
}

/** Draws a stroke on the signature pad, as a finger would. */
export async function drawSignature(page: Page): Promise<void> {
  const pad = page.getByTestId('signature-pad');
  // Clear of the actions pinned at the bottom.
  await pad.evaluate((el) => {
    el.scrollIntoView({ block: 'center' });
  });
  const box = await pad.boundingBox();
  if (!box) throw new Error('no signature pad');
  await page.mouse.move(box.x + 20, box.y + 40);
  await page.mouse.down();
  await page.mouse.move(box.x + 120, box.y + 90, { steps: 6 });
  await page.mouse.move(box.x + 220, box.y + 30, { steps: 6 });
  await page.mouse.up();
}

/**
 * On the consent screen: agrees to both Part A statements and signs, drawn when scripts run,
 * typed otherwise; then the questions open on About you.
 */
export async function signConsent(page: Page): Promise<void> {
  await expect(page).toHaveURL(/\?screen=consent/);
  await notUnderAge(page);
  for (const card of await page
    .getByRole('group')
    .filter({ has: page.getByText('I agree', { exact: true }) })
    .all()) {
    await card.getByText('I agree', { exact: true }).click();
  }
  if (await page.getByTestId('signature-pad').isVisible()) await drawSignature(page);
  else await page.getByLabel('Type your full name to sign').fill('Test Patient');
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page).toHaveURL(/\?screen=about_you$/);
}

/** About you (INT-05): only gender is needed; the rest is left for the physio. */
export async function aboutYou(page: Page, gender = 'Female'): Promise<void> {
  await expect(page).toHaveURL(/\?screen=about_you$/);
  await page.getByRole('group', { name: 'Gender' }).getByText(gender, { exact: true }).click();
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page).toHaveURL(/\?screen=problem$/);
}

/** Whether a drawn signature is in the private `signatures` bucket. */
export async function signatureStored(path: string): Promise<boolean> {
  const [row] = await db().execute<{ stored: boolean }>(
    sql`select exists (select 1 from storage.objects where bucket_id = 'signatures' and name = ${path}) as stored`,
  );
  return row?.stored ?? false;
}

/** When a visit's form was submitted and its link completed (INT-05). */
export async function submittedOf(appointmentId: string) {
  const [row] = await db()
    .select({ submittedAt: intakeResponse.submittedAt, completedAt: patientLink.completedAt })
    .from(intakeResponse)
    .innerJoin(patientLink, eq(patientLink.id, intakeResponse.patientLinkId))
    .where(eq(intakeResponse.appointmentId, appointmentId));
  return row;
}

/** A visit's reports and who added them (INT-05: the patient, through the link). */
export function reportsOf(appointmentId: string) {
  return db()
    .select({
      contentType: patientReport.contentType,
      uploadedBy: patientReport.uploadedBy,
      patientLinkId: patientReport.patientLinkId,
    })
    .from(patientReport)
    .where(eq(patientReport.appointmentId, appointmentId));
}

/**
 * What the submit pipeline left for a visit (INT-10): its episode and status, whether the form
 * and the appointment point to it, the alerts raised, the precautions, the AI job and the
 * notifications sent.
 */
export async function pipelineOf(appointmentId: string) {
  const [visit] = await db()
    .select({ episodeId: appointment.episodeId, formEpisode: intakeResponse.episodeId })
    .from(appointment)
    .leftJoin(intakeResponse, eq(intakeResponse.appointmentId, appointment.id))
    .where(eq(appointment.id, appointmentId));
  const episodeId = visit?.episodeId ?? null;
  if (!episodeId) return { episodeId, formEpisode: visit?.formEpisode ?? null };
  const [opened] = await db()
    .select({ status: episode.status, bodyRegion: episode.bodyRegion })
    .from(episode)
    .where(eq(episode.id, episodeId));
  const alerts = await db()
    .select({
      ruleKey: redFlagAlert.ruleKey,
      display: redFlagAlert.display,
      status: redFlagAlert.status,
      signedOff: redFlagAlert.signedOff,
      kbVersionId: redFlagAlert.kbVersionId,
    })
    .from(redFlagAlert)
    .where(eq(redFlagAlert.episodeId, episodeId))
    .orderBy(asc(redFlagAlert.ruleKey));
  const precautions = await db()
    .select({ key: precaution.key })
    .from(precaution)
    .where(eq(precaution.episodeId, episodeId))
    .orderBy(asc(precaution.key));
  const jobs = await db()
    .select({ kind: job.kind })
    .from(job)
    .where(
      inArray(job.idempotencyKey, [
        `ai.preparation_sheet:${episodeId}`,
        `intake.submitted:${appointmentId}`,
      ]),
    )
    .orderBy(asc(job.kind));
  const told = await db()
    .select({ staffUserId: notification.staffUserId, kind: notification.kind })
    .from(notification)
    .where(eq(notification.appointmentId, appointmentId))
    .orderBy(asc(notification.kind));
  return {
    episodeId,
    formEpisode: visit?.formEpisode ?? null,
    status: opened?.status,
    bodyRegion: opened?.bodyRegion,
    alerts,
    precautions: precautions.map((row) => row.key),
    jobs: jobs.map((row) => row.kind),
    told,
  };
}

/**
 * Removes the pipeline's jobs, alerts and precautions for these visits' episodes, as a test clean
 * up: an emergency left Raised would show its banner on every page at the centre (ALT-01).
 */
export async function removePipelineRows(appointmentIds: string[]): Promise<void> {
  if (appointmentIds.length === 0) return;
  const episodes = (
    await db()
      .select({ id: appointment.episodeId })
      .from(appointment)
      .where(inArray(appointment.id, appointmentIds))
  ).flatMap((row) => (row.id ? [row.id] : []));
  const keys = [
    ...appointmentIds.map((id) => `intake.submitted:${id}`),
    ...episodes.map((id) => `ai.preparation_sheet:${id}`),
  ];
  await withActor(db(), systemActor('tests'), async (tx) => {
    await tx.delete(job).where(inArray(job.idempotencyKey, keys));
    if (episodes.length === 0) return;
    await tx.delete(redFlagAlert).where(inArray(redFlagAlert.episodeId, episodes));
    await tx.delete(precaution).where(inArray(precaution.episodeId, episodes));
  });
}

/** Who moved a visit's alerts, and how, from the audit trail (ALT-01). */
export async function alertTrailOf(appointmentId: string) {
  const alerts = await db()
    .select({ id: redFlagAlert.id })
    .from(redFlagAlert)
    .where(eq(redFlagAlert.appointmentId, appointmentId));
  if (alerts.length === 0) return [];
  const rows = await db()
    .select({ action: auditEvent.action, actor: auditEvent.actor, after: auditEvent.after })
    .from(auditEvent)
    .where(
      and(
        eq(auditEvent.entity, 'red_flag_alert'),
        inArray(
          auditEvent.entityId,
          alerts.map((alert) => alert.id),
        ),
        eq(auditEvent.action, 'update'),
      ),
    )
    .orderBy(asc(auditEvent.at));
  return rows.map((row) => ({
    actor: row.actor,
    status: (row.after as { status?: string } | null)?.status,
  }));
}

/** Another browser like this project's: the patient's phone, or the desk. */
export async function otherBrowser(browser: Browser): Promise<Page> {
  const { viewport, isMobile, hasTouch, userAgent, deviceScaleFactor, baseURL } =
    test.info().project.use;
  const context = await browser.newContext({
    viewport,
    isMobile,
    hasTouch,
    userAgent,
    deviceScaleFactor,
    baseURL,
  });
  return context.newPage();
}

const question = (page: Page, text: string) => page.getByRole('group', { name: text });
const next = (page: Page) => page.getByRole('button', { name: 'Next' }).click();
const at = (page: Page, screen: string) =>
  expect.poll(() => new URL(page.url()).searchParams.get('screen')).toBe(screen);
export const saddle = 'Any numbness around your bottom or between your legs?';

/** Fills a back form: No to every warning sign but `yes`, then the Health check, then submits. */
export async function submitBackForm(
  page: Page,
  path: string,
  yes: string[],
  conditions: string[],
) {
  await page.goto(path);
  await page.getByRole('link', { name: 'Start' }).click();
  await signConsent(page);
  await aboutYou(page, 'Male');
  await question(page, 'Body region').getByText('Back', { exact: true }).click();
  await next(page);
  await at(page, 'warning_signs');
  for (const group of await page.getByRole('group').all()) {
    const no = group.getByText('No', { exact: true });
    if ((await no.count()) > 0 && (await no.isVisible())) await no.click();
  }
  for (const text of yes) await question(page, text).getByText('Yes', { exact: true }).click();
  const minutes = page.getByLabel(/how many minutes does it last/);
  if ((await minutes.count()) > 0) await minutes.fill('0');
  await next(page);
  await at(page, 'health_check');
  for (const text of conditions) {
    await question(page, 'Tick any that apply').getByText(text, { exact: true }).click();
  }
  await next(page);
  await at(page, 'activity');
  await next(page);
  await at(page, 'history');
  await next(page);
  await at(page, 'end');
  await page.getByRole('button', { name: 'Submit' }).click();
  await expect(page.getByTestId('patient-link-status')).toHaveText(
    'Thank you. Your answers are with your physiotherapist.',
  );
}
