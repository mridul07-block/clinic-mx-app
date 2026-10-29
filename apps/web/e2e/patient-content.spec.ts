import { createDb, kbPatientContent, systemActor, withActor } from '@clinic-mx/db';
import { expect, test } from '@playwright/test';
import { eq, sql } from 'drizzle-orm';
import { signInWithCode, temporaryWithCode } from './staff';

// AI-07 done when: content generated once per condition; clinician approves before patients see
// it. Recommended defaults (29 October 2026): until the AI gateway has its key, a consultant who
// treats patients writes the draft; approving it is what patients see; others read it. Generated
// test text only, removed after.

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

/** Each project's own condition of the live version, so phone and desktop never share one. */
async function conditionOfThisProject(): Promise<string> {
  const index = test.info().project.name === 'phone' ? 0 : 1;
  const rows = await db().execute<{ condition_id: string }>(sql`
    select c.condition_id from kb_condition c
    where c.kb_version_id = internal.live_kb_version()
    group by c.condition_id order by c.condition_id desc limit 2`);
  const id = rows[index]?.condition_id;
  if (!id) throw new Error('The live knowledge base has too few conditions.');
  return id;
}

/** Removes the condition's test content; approved text is kept by a guard, so it is lifted here. */
async function removeContent(conditionId: string): Promise<void> {
  await withActor(db(), systemActor('tests'), async (tx) => {
    await tx.execute(sql`alter table kb_patient_content disable trigger patient_content_guard`);
    await tx.delete(kbPatientContent).where(eq(kbPatientContent.conditionId, conditionId));
    await tx.execute(sql`alter table kb_patient_content enable trigger patient_content_guard`);
  });
}

const conditions: string[] = [];
test.afterEach(async () => {
  for (const id of conditions.splice(0)) await removeContent(id);
});

test('a consultant writes and approves a condition’s patient content; a physio reads it', async ({
  page,
  browser,
}) => {
  test.slow();
  const conditionId = await conditionOfThisProject();
  conditions.push(conditionId);
  await removeContent(conditionId);
  const consultant = await temporaryWithCode('physiotherapist', ['HSR Layout'], {
    consultant: true,
  });
  await signInWithCode(page, consultant.email, consultant.secret);
  await page.goto('/app/knowledge-base');
  await page.getByTestId('patient-content-link').click();
  await expect(page.getByRole('heading', { name: 'Patient content', level: 1 })).toBeVisible();
  await page.getByLabel('Find a condition').fill(conditionId);
  await page.getByLabel('Find a condition').press('Enter');
  const row = page.getByTestId('patient-content-row').filter({ hasText: conditionId });
  await expect(row).toContainText('No content yet');
  await row.click();

  const approvedPart = page.getByTestId('patient-content-approved');
  await expect(approvedPart).toContainText('Nothing yet');
  const form = page.getByTestId('patient-content-form');
  // Nothing written: each part is asked for.
  await form.getByRole('button', { name: 'Save as draft' }).click();
  await expect(form).toContainText('Write the explanation.');
  await form.getByLabel('Explanation').fill('Test explanation in plain words.');
  await form.getByLabel('Roadmap').fill('Test roadmap.');
  await form.getByLabel('Home advice').fill('Test home advice.');
  await form.getByLabel('Warning signs').fill('Test warning signs.');
  await form.getByRole('button', { name: 'Save as draft' }).click();
  await expect(form.getByText('Draft saved.')).toBeVisible();
  const decide = page.getByTestId('patient-content-decide');
  await expect(decide).toBeVisible();
  await expect(approvedPart).toContainText('Nothing yet');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({
    path: test.info().outputPath('patient-content-draft.png'),
    fullPage: true,
  });
  await decide.getByRole('button', { name: 'Approve for patients' }).click();
  await expect(page.getByText('Approved. Patients see this content from now on.')).toBeVisible();
  await expect(approvedPart).toContainText('Test explanation in plain words.');
  await expect(approvedPart).toContainText(`Approved by ${consultant.name}`);

  // A physio who does not consult reads it, and has nothing to write or approve.
  const physio = await temporaryWithCode('physiotherapist', ['HSR Layout']);
  const context = await browser.newContext(test.info().project.use);
  const other = await context.newPage();
  await signInWithCode(other, physio.email, physio.secret);
  await other.goto(`/app/knowledge-base/patient-content/${conditionId}`);
  await expect(other.getByTestId('patient-content-approved')).toContainText(
    'Test explanation in plain words.',
  );
  await expect(other.getByTestId('patient-content-form')).toHaveCount(0);
  await expect(other.getByTestId('patient-content-draft')).toContainText('No draft.');
  await context.close();
});
