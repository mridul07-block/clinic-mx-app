import { expect, test } from '@playwright/test';
import { testPatient } from './patients';
import { signIn, signInWithCode, temporaryDesk, temporaryWithCode } from './staff';

// ADM-03 done when: the Super Admin records a patient's export or deletion request with its due
// date and exports their data; deletion waits for the clinic's retention decision. Recommended
// defaults under the user's standing approval (29 October 2026): recorded from the patient's
// record, due the setting's days later, closed once. Generated test patients only.

test('the Super Admin records a request for a copy, downloads the data and closes it', async ({
  page,
}) => {
  test.slow();
  const admin = await temporaryWithCode('super_admin');
  const patient = await testPatient();
  await signInWithCode(page, admin.email, admin.secret);
  await page.goto(`/app/patients/${patient.id}`);
  await page.getByRole('link', { name: 'Record a data request' }).click();
  await expect(page.getByRole('heading', { name: 'New data request' })).toBeVisible();

  // What they ask for is required.
  // A long address in the words never widens the page.
  await page
    .getByLabel('What they asked for')
    .fill('Test request: a copy by email to test.patient.with.a.very.long.address@example.test');
  await page.getByRole('button', { name: 'Record request' }).click();
  await expect(page.getByText('Choose what they ask for.')).toBeVisible();

  await page.getByLabel('They ask for').selectOption({ label: 'A copy of their data' });
  await page.getByRole('button', { name: 'Record request' }).click();
  await expect(page.getByRole('heading', { name: 'A copy of their data' })).toBeVisible();
  await expect(page.getByRole('main')).toContainText('Open');
  await expect(page.getByTestId('data-request-facts')).toContainText(`Recorded by${admin.name}`);
  const fits = () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
  expect(await fits()).toBe(true);
  await page.screenshot({ path: test.info().outputPath('data-request.png'), fullPage: true });

  // Their data, as one file.
  const download = page.waitForEvent('download');
  await page.getByTestId('data-request-export').click();
  const file = await download;
  expect(file.suggestedFilename()).toBe(`clinic-mx-${patient.opNumber}-data.json`);
  const { readFile } = await import('node:fs/promises');
  const data = JSON.parse(await readFile(await file.path(), 'utf8')) as {
    patient: { id: string };
    records: Record<string, unknown[]>;
  };
  expect(data.patient.id).toBe(patient.id);
  expect(Object.keys(data.records)).toContain('data_request');

  await page.getByLabel('What was done').fill('Test: sent by email');
  await page.getByRole('button', { name: 'Close as done' }).click();
  await expect(page.getByTestId('data-request-outcome')).toHaveText('Test: sent by email');
  await expect(page.getByTestId('data-request-export')).toHaveCount(0);

  // Listed, closed; its file is gone.
  await page.goto('/app/data-requests');
  const listed = page.getByTestId('data-request').filter({ hasText: patient.name });
  await expect(listed).toContainText('Done');
  const id = await listed.getAttribute('data-request');
  const gone = await page.request.post(`/app/data-requests/${id ?? ''}/export`);
  expect(gone.status()).toBe(404);
});

test('a deletion request is recorded and waits for the retention period', async ({ page }) => {
  const admin = await temporaryWithCode('super_admin');
  const patient = await testPatient();
  await signInWithCode(page, admin.email, admin.secret);
  await page.goto(`/app/data-requests/new?patient=${patient.id}`);
  await page.getByLabel('They ask for').selectOption({ label: 'Delete their data' });
  await page.getByLabel('What they asked for').fill('Test request: delete everything');
  await page.getByRole('button', { name: 'Record request' }).click();
  await expect(page.getByRole('main')).toContainText('retention period (PRD decision 20)');
  await expect(page.getByTestId('data-request-export')).toHaveCount(0);
});

test('nobody else records or reads data requests', async ({ page }) => {
  const patient = await testPatient();
  const desk = await temporaryDesk();
  await signIn(page, desk.email);
  await page.goto(`/app/patients/${patient.id}`);
  await expect(page.getByRole('heading', { name: patient.name })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Record a data request' })).toHaveCount(0);
  await page.goto('/app/data-requests');
  await expect(page).toHaveURL(/\/app\/not-allowed/);
});

test('Finance has no data requests either', async ({ page }) => {
  const finance = await temporaryWithCode('finance');
  await signInWithCode(page, finance.email, finance.secret);
  await page.goto('/app/data-requests');
  await expect(page).toHaveURL(/\/app\/not-allowed/);
});
