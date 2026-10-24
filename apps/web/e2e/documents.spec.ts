import { expect, test, type Page } from '@playwright/test';
import { auditEvent, createDb } from '@clinic-mx/db';
import { and, eq } from 'drizzle-orm';
import { otherBrowser } from './intake';
import { testDocument } from './documents';
import { testEpisode, testPatient } from './patients';
import {
  centreId,
  signIn,
  signInWithCode,
  staffRow,
  temporaryDesk,
  temporaryWithCode,
} from './staff';

// ALT-05 done when: documents are A4 PDFs on the centre's letterhead, versioned and stored.
// Decisions (user, 25 October 2026): the letterhead is the centre's own, previewed by the Super
// Admin from the centre; credentials are kept on the staff record for the sign off; generated
// documents are listed on the patient record with every version, opened through our domain.

/** The page never scrolls sideways (a tab row once overflowed at 360 px). */
async function fitsTheScreen(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
}

test('the Super Admin previews a centre’s letterhead; nobody else can', async ({
  page,
  browser,
}) => {
  const admin = await temporaryWithCode('super_admin');
  await signInWithCode(page, admin.email, admin.secret);
  const hsr = await centreId('HSR Layout');
  await page.goto(`/app/centres/${hsr}`);
  const preview = page.getByRole('link', { name: 'Preview letterhead (PDF)' });
  await expect(preview).toBeVisible();
  await expect(preview).toHaveAttribute('target', '_blank');
  await fitsTheScreen(page);
  await page.screenshot({ path: test.info().outputPath('centre-letterhead.png'), fullPage: true });

  const href = (await preview.getAttribute('href')) ?? '';
  const opened = await page.request.get(href);
  expect(opened.status()).toBe(200);
  expect(opened.headers()['content-type']).toBe('application/pdf');
  expect(opened.headers()['cache-control']).toBe('private, no-store');
  const pdf = (await opened.body()).toString('latin1');
  expect(pdf.startsWith('%PDF-')).toBe(true);
  expect(pdf).toMatch(/\/Type \/Pages[^>]*\/Count 2/);

  // The front desk gets "not found"; signed out, the proxy sends it to sign in.
  const desk = await temporaryDesk();
  const deskPage = await otherBrowser(browser);
  await signIn(deskPage, desk.email);
  expect((await deskPage.request.get(href)).status()).toBe(404);
  await deskPage.context().close();
  await page.context().clearCookies();
  const signedOut = await page.request.get(href, { maxRedirects: 0 });
  expect(signedOut.status()).toBe(307);
  expect(signedOut.headers().location).toContain('/app/sign-in');
});

test('the Super Admin keeps a clinician’s credentials for the sign off', async ({ page }) => {
  const admin = await temporaryWithCode('super_admin');
  const physio = await temporaryWithCode('physiotherapist', ['HSR Layout']);
  await signInWithCode(page, admin.email, admin.secret);
  await page.goto(`/app/staff/${physio.id}`);
  await page.getByLabel('Credentials').fill('BPT, MPT (Ortho)');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('Changes saved.')).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('Credentials')).toHaveValue('BPT, MPT (Ortho)');
  await fitsTheScreen(page);
  expect((await staffRow(physio.email)).credentials).toBe('BPT, MPT (Ortho)');
});

test('a clinician anywhere opens each version of a document; the desk cannot', async ({
  page,
  browser,
}) => {
  const patient = await testPatient();
  const episodeId = await testEpisode(patient.id, 'awaiting_consultation');
  const hsr = await centreId('HSR Layout');
  const sourceId = crypto.randomUUID();
  const summary = {
    kind: 'consultation_summary',
    patientId: patient.id,
    episodeId,
    centreId: hsr,
    sourceId,
  } as const;
  const first = await testDocument(summary);
  const second = await testDocument(summary);
  expect([first.version, second.version]).toEqual([1, 2]);

  // A physio at another centre reads it, newest version first and the earlier one under it.
  const physio = await temporaryWithCode('physiotherapist', ['Koramangala']);
  await signInWithCode(page, physio.email, physio.secret);
  await page.goto(`/app/patients/${patient.id}?tab=documents`);
  const documents = page.getByTestId('patient-documents');
  await expect(documents.getByTestId('patient-document')).toHaveCount(1);
  await expect(documents).toContainText('Consultation summary');
  await expect(documents).toContainText('Version 2 ·');
  await expect(documents.getByRole('link', { name: /^Version 1, / })).toBeVisible();
  await fitsTheScreen(page);
  await page.screenshot({ path: test.info().outputPath('documents-tab.png'), fullPage: true });

  const href = (await documents.getByRole('link', { name: 'Open PDF' }).getAttribute('href')) ?? '';
  expect(href).toBe(`/app/documents/${second.id}`);
  const opened = await page.request.get(href);
  expect(opened.status()).toBe(200);
  expect(opened.headers()['content-type']).toBe('application/pdf');
  expect(opened.headers()['content-disposition']).toBe(
    'inline; filename="consultation-summary-v2.pdf"',
  );
  expect(opened.headers()['cache-control']).toBe('private, no-store');

  // The open is logged as a view of the document.
  const url = process.env.DIRECT_DATABASE_URL ?? '';
  const { db, close } = createDb(url, { max: 1 });
  const views = await db
    .select({ actor: auditEvent.actor })
    .from(auditEvent)
    .where(
      and(
        eq(auditEvent.action, 'view'),
        eq(auditEvent.entity, 'document'),
        eq(auditEvent.entityId, second.id),
      ),
    );
  await close();
  expect(views).toEqual([{ actor: `staff:${physio.id}` }]);

  // The front desk at its own centre: not found.
  const desk = await temporaryDesk();
  const deskPage = await otherBrowser(browser);
  await signIn(deskPage, desk.email);
  expect((await deskPage.request.get(href)).status()).toBe(404);
  await deskPage.context().close();
});
