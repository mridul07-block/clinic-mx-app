import { expect, test, type Page } from '@playwright/test';
import { restoreAppointmentTypes, snapshotAppointmentTypes } from './appointment-types';
import {
  exclusively,
  signIn,
  signInWithCode,
  temporaryDesk,
  temporarySuperAdmin,
  temporaryWithCode,
} from './staff';

// SET-03 done when: length per type and per physio. Decisions (user, 22 October 2026): the Super
// Admin keeps the types and each physio's own lengths. Tests that change them take turns (the
// `e2e appointment types` lock) and put everything back afterwards.

/** Runs `work` alone among appointment type tests, restoring the types afterwards. */
async function changingTypes(work: () => Promise<void>) {
  await exclusively('e2e appointment types', async () => {
    const snapshot = await snapshotAppointmentTypes();
    try {
      await work();
    } finally {
      await restoreAppointmentTypes(snapshot);
    }
  });
}

async function signInAdmin(page: Page) {
  const admin = await temporarySuperAdmin({ support: false });
  await signInWithCode(page, admin.email, admin.secret);
}

const typeRow = (page: Page, name: string) =>
  page.getByTestId('appointment-type').filter({ has: page.getByText(name, { exact: true }) });

test('the Super Admin sets the length of each appointment type', async ({ page }) => {
  const added = `E2E home visit ${crypto.randomUUID().slice(0, 6)}`;
  await signInAdmin(page);
  await changingTypes(async () => {
    await page.goto('/app');
    await page.getByRole('main').getByRole('link', { name: 'Appointment types' }).click();
    await expect(page.getByRole('heading', { name: 'Appointment types' })).toBeVisible();
    await expect(typeRow(page, 'Consultation')).toContainText('45 minutes');
    await expect(typeRow(page, 'Session')).toContainText('45 minutes');
    await expect(typeRow(page, 'Review')).toContainText('45 minutes');
    await expect(typeRow(page, 'Zero Gravity Treadmill')).toContainText('30 minutes');

    await typeRow(page, 'Review').click();
    await page.getByLabel('Length in minutes').fill('50');
    await page.getByRole('button', { name: 'Save appointment type' }).click();
    await expect(page.getByText('Use steps of 15 minutes, for example 45.')).toBeVisible();
    await page.getByLabel('Length in minutes').fill('30');
    await page.getByRole('button', { name: 'Save appointment type' }).click();
    await expect(page.getByRole('status')).toHaveText('Appointment type saved.');
    await page.getByRole('main').getByRole('link', { name: 'Appointment types' }).click();
    await expect(typeRow(page, 'Review')).toContainText('30 minutes');

    await page.getByRole('link', { name: 'Add an appointment type' }).click();
    await page.getByLabel('Name').fill(added);
    await page.getByLabel('Length in minutes').fill('90');
    await page.getByRole('button', { name: 'Add appointment type' }).click();
    await expect(page.getByRole('status')).toHaveText('Appointment type added.');
    await page.getByRole('button', { name: 'Deactivate appointment type' }).click();
    await page.getByRole('button', { name: 'Deactivate appointment type' }).click();
    await expect(page.getByRole('status')).toContainText('Appointment type deactivated.');
    await page.getByRole('main').getByRole('link', { name: 'Appointment types' }).click();
    await expect(typeRow(page, added)).toContainText('1 hour 30 minutes');
    await expect(typeRow(page, added)).toContainText('Inactive');
  });
});

test('the Super Admin gives a physio their own length, and clears it', async ({ page }) => {
  const physio = await temporaryWithCode('physiotherapist');
  await signInAdmin(page);
  await changingTypes(async () => {
    await page.goto(`/app/staff/${physio.id}`);
    await expect(page.getByRole('heading', { name: 'Appointment lengths' })).toBeVisible();
    const session = page.getByLabel('Session', { exact: true });
    await expect(session).toHaveValue('');
    await expect(session).toHaveAttribute('placeholder', '45');
    await session.fill('50');
    await page.getByRole('button', { name: 'Save lengths' }).click();
    await expect(page.getByText('Use steps of 15 minutes, for example 45.')).toBeVisible();
    await session.fill('60');
    await page.getByRole('button', { name: 'Save lengths' }).click();
    await expect(page.getByText('Appointment lengths saved.')).toBeVisible();

    await page.goto('/app/appointment-types');
    await expect(typeRow(page, 'Session')).toContainText('1 physio has their own length');

    await page.goto(`/app/staff/${physio.id}`);
    await expect(page.getByLabel('Session', { exact: true })).toHaveValue('60');
    await page.getByLabel('Session', { exact: true }).fill('');
    await page.getByRole('button', { name: 'Save lengths' }).click();
    await expect(page.getByText('Appointment lengths saved.')).toBeVisible();
    await page.goto('/app/appointment-types');
    await expect(typeRow(page, 'Session')).toContainText('Every physio uses this length');
  });
});

test('nobody but the Super Admin opens appointment types', async ({ page }) => {
  const desk = await temporaryDesk();
  await signIn(page, desk.email);
  await expect(page.getByRole('main').getByRole('link', { name: 'Appointment types' })).toHaveCount(
    0,
  );
  await page.goto('/app/appointment-types');
  await expect(page).toHaveURL(/\/app\/not-allowed/);
});
