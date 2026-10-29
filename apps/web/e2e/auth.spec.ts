import { expect, test, type Page } from '@playwright/test';
import {
  centreId,
  changeStaff,
  changingDeskStaff,
  clearMail,
  clearTwoStep,
  resetLinkFor,
  seedPassword,
  sessionTokenClaims,
  setPassword,
  signIn,
  signInStaff,
  staffCentres,
  staffRow,
  supabaseUrl,
} from './staff';
import { totpCode } from './totp';

// IAM-01 done when: login works with no browser call to Supabase. Staff sign in, sign out and
// reset their password through our server only; runs on the 360 px phone and on desktop against
// the local Supabase stack.

/** Every URL the page requests, for checking none of them is Supabase. */
function recordRequests(page: Page): string[] {
  const urls: string[] = [];
  page.on('request', (request) => urls.push(request.url()));
  return urls;
}

function expectNoSupabaseCalls(urls: string[]) {
  expect(urls.length).toBeGreaterThan(0);
  const supabase = new URL(supabaseUrl()).origin;
  expect(urls.filter((url) => url.startsWith(supabase) || /supabase\.(co|in)\b/.test(url))).toEqual(
    [],
  );
}

/** Where a role lands after signing in (`homePath`). */
const landing = (role: string) =>
  role === 'Finance'
    ? /\/app\/finance\/collections$/
    : role === 'Super Admin'
      ? /\/app\/overview$/
      : /\/app$/;

test('signs in and out with no browser call to Supabase', async ({ page, context }) => {
  const urls = recordRequests(page);
  await page.goto('/app');
  await expect(page).toHaveURL(/\/app\/sign-in$/);
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();

  const staff = signInStaff();
  await signIn(page, staff.email);
  // Each role lands on its own screen: Finance on Collections (DSH-04), the Super Admin on home.
  await expect(page).toHaveURL(landing(staff.role));
  await page.goto('/app');
  await expect(page.getByText(`Signed in as ${staff.name}, ${staff.role}`)).toBeVisible();

  // The session lives in HTTP only, secure, same site cookies that page scripts cannot read.
  const session = (await context.cookies()).filter((cookie) => cookie.name.startsWith('sb-'));
  expect(session.length).toBeGreaterThan(0);
  for (const cookie of session) {
    expect(cookie).toMatchObject({ httpOnly: true, secure: true, sameSite: 'Lax' });
  }
  expect(await page.evaluate(() => document.cookie)).not.toContain('sb-');

  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/app\/sign-in$/);
  await page.goto('/app');
  await expect(page).toHaveURL(/\/app\/sign-in$/);

  expectNoSupabaseCalls(urls);
});

test('returns to the page that was asked for after signing in', async ({ page }) => {
  await page.goto('/app/test-harness/autosave?id=next-check');
  await expect(page).toHaveURL(/\/app\/sign-in\?next=/);
  await signIn(page, signInStaff().email);
  await expect(page).toHaveURL(/\/app\/test-harness\/autosave\?id=next-check$/);
});

test('a signed in person opening sign in goes to the staff app', async ({ page }) => {
  await signIn(page, signInStaff().email);
  await page.goto('/app/sign-in');
  await expect(page).toHaveURL(landing(signInStaff().role));
});

test('wrong details are refused without saying whether the email has an account', async ({
  page,
}) => {
  await page.goto('/app/sign-in');
  const refusal = page.getByText('That email and password do not match an active staff account.');

  const { email } = signInStaff();
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill('not the password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(refusal).toBeVisible();
  await expect(page.getByLabel('Email')).toHaveValue(email);

  await page.getByLabel('Email').fill('nobody@clinicmx.test');
  await page.getByLabel('Password', { exact: true }).fill('not the password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(refusal).toBeVisible();
  await expect(page).toHaveURL(/\/app\/sign-in$/);
});

test('signing out deletes drafts from the device, after asking if any are unsaved', async ({
  page,
}) => {
  await signIn(page, signInStaff().email);
  // A draft the server cannot save: it stays on the device.
  await page.route('**/api/test-harness/notes/**', (route) =>
    route.request().method() === 'PUT' ? route.abort() : route.continue(),
  );
  const noteId = ['sign-out', test.info().project.name].join('-');
  await page.goto(`/app/test-harness/autosave?id=${noteId}`);
  await page.getByLabel('Note text').fill('Not saved before signing out');
  await expect(page.getByText('Not saved yet', { exact: true })).toBeVisible();

  await page.goto('/app');
  await page.getByRole('button', { name: 'Sign out' }).click();
  const warning = page.getByText('1 change is not saved yet.');
  await expect(warning).toBeVisible();
  await page.getByRole('button', { name: 'Stay signed in' }).click();
  await expect(warning).toBeHidden();

  await page.getByRole('button', { name: 'Sign out' }).click();
  await page.getByRole('button', { name: 'Sign out and delete them' }).click();
  await expect(page).toHaveURL(/\/app\/sign-in$/);
  const drafts = await page.evaluate(
    () =>
      new Promise<number>((resolve, reject) => {
        const open = indexedDB.open('clinic-mx-drafts');
        open.onerror = () => {
          reject(new Error('drafts database did not open'));
        };
        open.onsuccess = () => {
          const count = open.result.transaction('drafts').objectStore('drafts').count();
          count.onsuccess = () => {
            resolve(count.result);
          };
        };
      }),
  );
  expect(drafts).toBe(0);
});

// IAM-03 done when: claims refresh when a user's role, ticks or centres change. Uses this file's
// own accounts (signInStaff), so no other test signs in as them meanwhile.
test.describe('role, ticks and centres in the token', () => {
  let original: Awaited<ReturnType<typeof staffRow>>;
  let originalCentres: string[];

  test.beforeEach(async () => {
    original = await staffRow(signInStaff().email);
    originalCentres = await staffCentres(signInStaff().email);
  });
  test.afterEach(async () => {
    await changeStaff(signInStaff().email, {
      values: {
        role: original.role,
        treatsPatients: original.treatsPatients,
        consultant: original.consultant,
        active: original.active,
      },
      centres: originalCentres,
    });
  });

  test('follow changes on the next page, without signing in again', async ({ page, context }) => {
    const staff = signInStaff();
    await signIn(page, staff.email);
    expect((await sessionTokenClaims(context)).clinic).toMatchObject({
      staff_id: original.id,
      role: original.role,
      all_centres: true,
      centres: [],
    });

    // The Super Admin moves them to Centre Manager at HSR Layout, treating patients.
    const hsr = await centreId('HSR Layout');
    await changeStaff(staff.email, {
      values: { role: 'centre_manager', treatsPatients: true },
      centres: [hsr],
    });
    await page.goto('/app/account');
    await expect(page).toHaveURL(/\/app\/account$/);
    await expect(page.getByText(`${staff.name}, Centre Manager`)).toBeVisible();
    await expect(page.getByText('HSR Layout')).toBeVisible();
    await expect(page.getByText('Treats patients')).toBeVisible();
    const moved = await sessionTokenClaims(context);
    expect(moved.aal).toBe('aal2');
    expect(moved.clinic).toEqual({
      staff_id: original.id,
      role: 'centre_manager',
      treats_patients: true,
      consultant: original.consultant,
      all_centres: false,
      centres: [hsr],
      support: false,
    });

    // Then the Consultant tick, the other way from how it was.
    await changeStaff(staff.email, { values: { consultant: !original.consultant } });
    await page.goto('/app');
    await expect(page).toHaveURL(/\/app$/);
    expect((await sessionTokenClaims(context)).clinic).toMatchObject({
      consultant: !original.consultant,
    });
  });

  test('a deactivated person is signed out on their next page', async ({ page }) => {
    await signIn(page, signInStaff().email);
    await changeStaff(signInStaff().email, { values: { active: false } });
    await page.goto('/app/account');
    await expect(page).toHaveURL(/\/app\/sign-in/);
  });
});

// Tests that change a Front Desk account: one account per project, in this file so they never
// run at the same time.
test.describe('Front Desk account changes', () => {
  const account = changingDeskStaff;

  test.beforeEach(async () => {
    await clearTwoStep(account().email);
  });
  test.afterEach(async () => {
    await setPassword(account().email, seedPassword());
    await clearTwoStep(account().email);
  });

  test('Front Desk can turn two step verification on from the account page', async ({ page }) => {
    const { email } = account();
    await signIn(page, email);
    // The Front Desk lands on Today (INT-01); Account is on Home.
    await expect(page).toHaveURL(/\/app\/today$/);
    await page.getByRole('link', { name: 'Home' }).click();
    await page.getByRole('main').getByRole('link', { name: 'Account' }).click();
    await page.getByRole('link', { name: 'Turn on two step verification' }).click();
    await expect(page.getByText('Each time you sign in you will also enter a code')).toBeVisible();
    const secret = (await page.getByTestId('two-step-key').innerText()).replace(/\s/g, '');
    await page.getByLabel('6 digit code').fill(totpCode(secret));
    await page.getByRole('button', { name: 'Turn on two step verification' }).click();
    await expect(page).toHaveURL(/\/app\/account\?two-step=on$/);
    await expect(page.getByText('Two step verification is on.')).toBeVisible();

    // From now on Front Desk is asked for a code like everyone else.
    await page.getByRole('button', { name: 'Sign out' }).click();
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password', { exact: true }).fill(seedPassword());
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(/\/app\/two-step$/);
  });

  test('a reset link from email sets a new password, once', async ({ page }) => {
    const { email } = account();
    const urls = recordRequests(page);
    await clearMail(email);

    await page.goto('/app/sign-in');
    await page.getByRole('link', { name: 'Forgot password?' }).click();
    // The sign in page has an Email field too: wait for the reset page before typing.
    await expect(page.getByRole('heading', { name: 'Reset your password' })).toBeVisible();
    await page.getByLabel('Email').fill(email);
    await page.getByRole('button', { name: 'Send reset link' }).click();
    await expect(page.getByText(`If ${email} has a staff account`)).toBeVisible();

    const link = await resetLinkFor(email);
    expect(new URL(link).pathname).toBe('/app/reset-password');
    await page.goto(link);
    await expect(page.getByRole('heading', { name: 'Choose a new password' })).toBeVisible();

    const password = page.getByLabel('New password');
    const save = page.getByRole('button', { name: 'Save password' });
    await password.fill('too short');
    await save.click();
    await expect(page.getByText('Use at least 12 characters.')).toBeVisible();

    // The link still works after a refused attempt, even one that reached Supabase.
    await password.fill(seedPassword());
    await save.click();
    await expect(
      page.getByText('That is your current password. Choose a different one.'),
    ).toBeVisible();

    const newPassword = `New-${seedPassword()}-${test.info().project.name}`;
    await password.fill(newPassword);
    await save.click();
    await expect(page).toHaveURL(/\/app\/sign-in\?password=changed$/);
    await expect(page.getByText('Password changed. Sign in with your new password.')).toBeVisible();

    await signIn(page, email, newPassword);
    await expect(page).toHaveURL(/\/app\/today$/);
    expectNoSupabaseCalls(urls);

    // Used once: the same link is refused afterwards.
    await page.getByRole('link', { name: 'Home' }).click();
    await page.getByRole('button', { name: 'Sign out' }).click();
    await page.goto(link);
    await page.getByLabel('New password').fill(`${newPassword}-again`);
    await page.getByRole('button', { name: 'Save password' }).click();
    await expect(page.getByText('This reset link has expired or was already used.')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Ask for a new link' })).toBeVisible();
  });

  test('an email without an account gets the same answer', async ({ page }) => {
    await clearMail('nobody@clinicmx.test');
    await page.goto('/app/forgot-password');
    await page.getByLabel('Email').fill('nobody@clinicmx.test');
    await page.getByRole('button', { name: 'Send reset link' }).click();
    await expect(page.getByText('If nobody@clinicmx.test has a staff account')).toBeVisible();
  });

  test('a link without its token asks for a new one', async ({ page }) => {
    await page.goto('/app/reset-password');
    await expect(
      page.getByText('This reset link is not complete. Ask for a new one.'),
    ).toBeVisible();
  });
});
