import { expect, test } from '@playwright/test';
import { fakeMobile, fakeName, testPatient } from './patients';
import { signIn, signInWithCode, temporaryDesk, temporaryWithCode } from './staff';

// SCH-01 done when: several patients per phone number; OP number from a per centre sequence.
// Patients are generated (rule 12) and stay: they are never deleted.

test('the front desk adds two people on one mobile, each with their own OP number', async ({
  page,
}) => {
  const supabaseRequests: string[] = [];
  page.on('request', (request) => {
    if (new URL(request.url()).hostname.endsWith('supabase.co')) {
      supabaseRequests.push(request.url());
    }
  });
  const desk = await temporaryDesk();
  const mobile = fakeMobile();
  const typedMobile = `${mobile.slice(3, 8)} ${mobile.slice(8)}`;
  const parent = fakeName('Test Parent');
  const child = fakeName('Test Child');
  await signIn(page, desk.email);

  await page.getByRole('link', { name: 'Patients' }).click();
  await expect(page.getByRole('heading', { name: 'Patients', level: 1 })).toBeVisible();
  await page.getByRole('link', { name: 'Add patient' }).click();
  // Name and mobile are all a new patient needs; the desk's one centre registers them.
  await expect(page.getByText('Registered at HSR Layout')).toBeVisible();
  await page.getByRole('button', { name: 'Add patient' }).click();
  await expect(page.getByText('Enter the patient’s name.')).toBeVisible();
  await page.getByLabel('Name', { exact: true }).fill(parent);
  await page.getByLabel('Mobile', { exact: true }).fill(typedMobile);
  await page.getByRole('button', { name: 'Add patient' }).click();
  await expect(page.getByRole('status')).toHaveText('Patient added.');
  await expect(page.getByRole('heading', { name: parent })).toBeVisible();
  const parentNumber = (await page.getByTestId('op-number').textContent()) ?? '';
  expect(parentNumber).toMatch(/^HSR-\d{5}$/);

  // The same mobile: the desk sees who is on it, then adds another person.
  await page.goto('/app/patients/new');
  await page.getByLabel('Name', { exact: true }).fill(child);
  await page.getByLabel('Mobile', { exact: true }).fill(mobile);
  await page.getByRole('button', { name: 'Add patient' }).click();
  const matches = page.getByTestId('phone-matches');
  await expect(matches.getByText('This mobile is already on file')).toBeVisible();
  await expect(matches).toContainText(parent);
  await expect(matches).toContainText(parentNumber);
  await matches.getByRole('button', { name: 'Add as a new person' }).click();
  await expect(page.getByRole('status')).toHaveText('Patient added.');
  await expect(page.getByRole('heading', { name: child })).toBeVisible();
  const childNumber = (await page.getByTestId('op-number').textContent()) ?? '';
  expect(childNumber).toMatch(/^HSR-\d{5}$/);
  expect(childNumber).not.toBe(parentNumber);
  await expect(page.getByTestId('same-mobile')).toContainText(parent);

  // Found by mobile (both) and by name (one).
  await page.goto('/app/patients');
  await page.getByLabel('Mobile or name').fill(`+91 ${typedMobile}`);
  await page.getByRole('button', { name: 'Search' }).click();
  await expect(page.getByTestId('patient')).toHaveCount(2);
  await page.getByLabel('Mobile or name').fill(child.toLowerCase());
  await page.getByRole('button', { name: 'Search' }).click();
  await expect(page.getByTestId('patient')).toHaveCount(1);
  await expect(page.getByTestId('patient')).toContainText(childNumber);

  // Details are edited; the OP number stays.
  await page.getByTestId('patient').click();
  await page.getByText('More details').click();
  await page.getByLabel('Sex').selectOption('female');
  await page.getByRole('button', { name: 'Save details' }).click();
  await expect(page.getByRole('status')).toHaveText('Details saved.');
  await expect(page.getByLabel('Sex')).toHaveValue('female');
  await expect(page.getByTestId('op-number')).toHaveText(childNumber);
  expect(supabaseRequests).toEqual([]);
});

test('a physiotherapist finds and reads a patient but cannot add or edit', async ({ page }) => {
  const patient = await testPatient({ centreCode: 'KOR' });
  const physio = await temporaryWithCode('physiotherapist', ['HSR Layout']);
  await signInWithCode(page, physio.email, physio.secret);
  await page.getByRole('link', { name: 'Patients' }).click();
  await expect(page.getByRole('link', { name: 'Add patient' })).toHaveCount(0);
  // Records are shared across centres: a Koramangala patient is found from HSR Layout.
  await page.getByLabel('Mobile or name').fill(patient.name);
  await page.getByRole('button', { name: 'Search' }).click();
  await page.getByTestId('patient').click();
  await expect(page.getByTestId('op-number')).toHaveText(patient.opNumber);
  expect(patient.opNumber).toMatch(/^KOR-\d{5}$/);
  await expect(page.getByRole('button', { name: 'Save details' })).toHaveCount(0);
  await expect(page.getByText('Not given').first()).toBeVisible();
  await page.goto('/app/patients/new');
  await expect(page).toHaveURL(/\/app\/not-allowed/);
});
