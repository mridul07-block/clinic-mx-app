import { expect, test, type Page } from '@playwright/test';
import { signIn, signInWithCode, temporaryDesk, temporaryWithCode } from './staff';

// SET-11 done when: keys, variables and versions are viewable by the Super Admin. The registry is
// in code (packages/schemas/src/message-templates.ts); nothing is changed, so nothing needs putting
// back.

const card = (page: Page, key: string) =>
  page
    .getByTestId('message-template')
    .filter({ has: page.getByTestId('template-key').getByText(key, { exact: true }) });

test('the Super Admin views every template with its key, variables and version', async ({
  page,
}) => {
  const supabaseRequests: string[] = [];
  page.on('request', (request) => {
    if (new URL(request.url()).hostname.endsWith('supabase.co')) {
      supabaseRequests.push(request.url());
    }
  });
  const admin = await temporaryWithCode('super_admin', []);
  await signInWithCode(page, admin.email, admin.secret);
  // The Super Admin lands on the Overview (DSH-05); the templates are a home link.
  await page.goto('/app');
  await page.getByRole('link', { name: 'WhatsApp templates' }).click();
  await expect(page.getByRole('heading', { name: 'WhatsApp templates', level: 1 })).toBeVisible();
  await expect(page.getByTestId('message-template')).toHaveCount(16);
  await expect(page.getByTestId('template-count')).toContainText('16 templates');

  const confirmation = card(page, 'booking_confirmation');
  await expect(confirmation.getByText('Booking confirmation', { exact: true })).toBeVisible();
  await expect(confirmation.getByText('Version 1')).toBeVisible();
  await expect(confirmation.getByText('Draft: text written in WA-06')).toBeVisible();
  await expect(confirmation.getByTestId('template-variables')).toContainText(
    "patient_name: The patient's first name",
  );
  for (const name of ['date', 'time', 'clinic', 'physio']) {
    await expect(
      confirmation.getByTestId('template-variables').getByText(name, { exact: true }),
    ).toBeVisible();
  }

  const reminder = card(page, 'day_before_reminder');
  await expect(reminder).toContainText('Confirm (Quick reply), Reschedule (WhatsApp Flow)');
  await expect(card(page, 'consultation_summary')).toContainText('Document (PDF)');
  expect(supabaseRequests).toEqual([]);
});

test('the front desk cannot open WhatsApp templates', async ({ page }) => {
  const desk = await temporaryDesk();
  await signIn(page, desk.email);
  await expect(page.getByRole('link', { name: 'WhatsApp templates' })).toHaveCount(0);
  await page.goto('/app/templates');
  await expect(page).toHaveURL(/\/app\/not-allowed/);
});

test('a physiotherapist cannot open WhatsApp templates', async ({ page }) => {
  const physio = await temporaryWithCode('physiotherapist', ['HSR Layout']);
  await signInWithCode(page, physio.email, physio.secret);
  await page.goto('/app/templates');
  await expect(page).toHaveURL(/\/app\/not-allowed/);
});
