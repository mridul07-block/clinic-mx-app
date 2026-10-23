import {
  appointment,
  auditEvent,
  consentRecord,
  createDb,
  intakeResponse,
  patientLink,
  patientReport,
  systemActor,
  withActor,
} from '@clinic-mx/db';
import { expect, type Page } from '@playwright/test';
import { and, asc, eq, sql } from 'drizzle-orm';

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
