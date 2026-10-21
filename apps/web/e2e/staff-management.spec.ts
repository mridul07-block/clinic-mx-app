import { expect, test, type Browser, type Page } from '@playwright/test';
import { resetLinkFor, seedPassword, signIn, staffAdmin, staffRow, testStaff } from './staff';

// IAM-06: the Super Admin invites, changes and deactivates staff; deactivating never deletes.
// Each test invites its own new person (a generated @clinicmx.test email; the rows stay,
// deactivated). On the 360 px phone and desktop, each project with its own Super Admin.

const newPerson = () => {
  const id = crypto.randomUUID().slice(0, 8);
  return { email: `invited.${id}@clinicmx.test`, name: `Test Invited ${id}` };
};

async function invite(page: Page, person: { email: string; name: string }) {
  await page.goto('/app');
  await page.getByRole('link', { name: 'Staff' }).click();
  await expect(page.getByRole('heading', { name: 'Staff', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Invite staff' }).click();
  await expect(page.getByRole('heading', { name: 'Invite staff' })).toBeVisible();
  await page.getByLabel('Email').fill(person.email);
  await page.getByLabel('Name').fill(person.name);
  await page.getByRole('radio', { name: 'Front Desk' }).check();
  await page.getByRole('checkbox', { name: 'HSR Layout' }).check();
  await page.getByRole('button', { name: 'Send invite' }).click();
  await expect(page.getByText(`Invite sent to ${person.email}.`)).toBeVisible();
  await expect(page.getByRole('heading', { name: person.name })).toBeVisible();
}

/** Opens an invite link in a browser of its own (the invited person's), sets a password, signs in. */
async function acceptInvite(browser: Browser, link: string, email: string) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(link);
  await expect(page.getByRole('heading', { name: 'Set your password' })).toBeVisible();
  await page.getByLabel('Password', { exact: true }).fill(seedPassword());
  await page.getByRole('button', { name: 'Save password' }).click();
  await expect(page).toHaveURL(/\/app\/sign-in\?password=changed/);
  await signIn(page, email);
  await expect(page.getByText('Signed in as')).toBeVisible();
  return page;
}

test.describe('as the Super Admin', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, staffAdmin().email);
  });

  test('invite, set role, ticks, centres and end date, then deactivate without deleting', async ({
    page,
    browser,
  }) => {
    test.setTimeout(90_000);
    const person = newPerson();
    await invite(page, person);
    await expect(page.getByText('Invite sent', { exact: true })).toBeVisible();

    const link = await resetLinkFor(person.email);
    expect(new URL(link).searchParams.get('type')).toBe('invite');
    const invited = await acceptInvite(browser, link, person.email);
    await expect(invited.getByText(`Signed in as ${person.name}, Front Desk`)).toBeVisible();

    // A second centre and an end date; they apply from the person's next page.
    await page.reload();
    await expect(page.getByText('Active', { exact: true })).toBeVisible();
    await page.getByRole('checkbox', { name: 'Koramangala' }).check();
    await page.getByLabel('Access end date').fill('2030-12-31');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByText('Changes saved.')).toBeVisible();
    await page.reload();
    await expect(page.getByText('Access ends 31 Dec 2030')).toBeVisible();
    await invited.goto('/app/account');
    await expect(invited.getByText('HSR Layout, Koramangala')).toBeVisible();

    // Deactivate: their next page goes to sign in; their row stays.
    await page.getByRole('button', { name: `Deactivate ${person.name}` }).click();
    await expect(
      page.getByText('Deactivated. They are signed out on their next page.'),
    ).toBeVisible();
    await invited.goto('/app');
    await expect(invited).toHaveURL(/\/app\/sign-in/);
    const row = await staffRow(person.email);
    expect(row.active).toBe(false);

    await page.reload();
    await expect(page.getByText('Deactivated', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: `Reactivate ${person.name}` }).click();
    await expect(page.getByText('Reactivated. They can sign in again.')).toBeVisible();
    await invited.context().close();
  });

  test('gives a one-time invite link to send another way', async ({ page, browser }) => {
    test.setTimeout(90_000);
    const person = newPerson();
    await invite(page, person);
    await page.getByRole('button', { name: 'Copy invite link' }).click();
    await expect(
      page.getByText('It works once, and replaces the link in their email.'),
    ).toBeVisible();
    const link = await page.getByLabel('Invite link').inputValue();
    expect(new URL(link).pathname).toBe('/app/reset-password');

    const invited = await acceptInvite(browser, link, person.email);
    await expect(invited.getByText(`Signed in as ${person.name}`)).toBeVisible();
    await invited.context().close();
  });

  test('checks the rules: Consultant needs Treats patients, a centre is required', async ({
    page,
  }) => {
    await page.goto('/app/staff/new');
    await page.getByLabel('Email').fill(newPerson().email);
    await page.getByLabel('Name').fill('Test Rules');
    await page.getByRole('radio', { name: 'Centre Manager' }).check();
    await page.getByRole('checkbox', { name: 'Consultant' }).check();
    await page.getByRole('button', { name: 'Send invite' }).click();
    await expect(page.getByText('Check the highlighted fields.')).toBeVisible();
    await expect(page.getByText('The Consultant tick needs Treats patients too.')).toBeVisible();
    await expect(page.getByText('Choose at least one centre.')).toBeVisible();

    await page.getByRole('radio', { name: 'Finance' }).check();
    await expect(page.getByText('Finance sees all centres.')).toBeVisible();
  });
});

test.describe('without staff.manage', () => {
  test('Front Desk is sent to the not allowed page', async ({ page }) => {
    await signIn(page, testStaff.desk.email);
    await page.goto('/app/staff');
    await expect(page).toHaveURL(/\/app\/not-allowed$/);
    await expect(page.getByRole('link', { name: 'Staff' })).toHaveCount(0);
  });
});
