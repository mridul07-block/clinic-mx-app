import { expect, test, type Browser, type Page } from '@playwright/test';
import { formOnTablet, sendToTablet, tabletNamed } from './kiosk';
import { submitLink, testLink } from './patient-links';
import { signIn, temporaryDesk } from './staff';

// IAM-10 done when: locked to patient pages; resets after a submit or 2 minutes idle. Each test
// has its own Front Desk member and tablet, so phone and desktop runs never share one. The
// tablet's timers run on Playwright's clock: the waiting screen asks every 3 seconds, the form
// resets after kiosk.idle_seconds (120) and the thank you after kiosk.thank_you_seconds (10).

const status = (page: Page) => page.getByTestId('patient-link-status');
const welcome = (page: Page) => page.getByTestId('kiosk-welcome');
/** The tablet reset: it took the form off (a server action, slower under load), then went back. */
const backToWelcome = (page: Page) => expect(page).toHaveURL(/\/kiosk$/, { timeout: 15_000 });
const shell = (page: Page) => page.locator('[data-kiosk]');
/** The tablet's reset timer runs: the page's script has started. Time counts from here. */
const armed = (page: Page) => expect(shell(page)).toHaveAttribute('data-kiosk', 'armed');
/** The form is still on the tablet: its reset has not begun. */
const stillOpen = (page: Page) =>
  expect(shell(page)).toHaveAttribute('data-kiosk', 'armed', { timeout: 1_000 });

/** Signs a new Front Desk member in on `page` and sets it up as an HSR Layout kiosk. */
async function setUpTablet(page: Page): Promise<{ kioskId: string; name: string }> {
  const desk = await temporaryDesk();
  const name = `Tablet ${crypto.randomUUID().slice(0, 8)}`;
  await signIn(page, desk.email);
  await page.goto('/app');
  await page.getByRole('link', { name: 'Kiosk tablets' }).click();
  await expect(page.getByRole('heading', { name: 'Kiosk tablets' })).toBeVisible();
  await expect(page.getByText('Centre: HSR Layout')).toBeVisible();
  await page.getByLabel('Tablet name').fill(name);
  await page.getByRole('button', { name: 'Set up as kiosk and sign out' }).click();
  await expect(page).toHaveURL(/\/kiosk$/);
  await expect(welcome(page)).toContainText('Welcome to Movementology Clinics');
  await expect(welcome(page)).toContainText('HSR Layout');
  return { kioskId: await tabletNamed(name), name };
}

/** Another browser on the same phone or desktop as this project: the patient's, or the tablet. */
async function anotherBrowser(browser: Browser): Promise<Page> {
  const {
    viewport,
    isMobile,
    hasTouch,
    userAgent,
    deviceScaleFactor,
    baseURL,
    locale,
    timezoneId,
  } = test.info().project.use;
  const context = await browser.newContext({
    viewport,
    isMobile,
    hasTouch,
    userAgent,
    deviceScaleFactor,
    baseURL,
    locale,
    timezoneId,
  });
  return context.newPage();
}

/**
 * Lets the waiting screen ask (fake clock) until the form sent to it opens, then waits for the
 * form's reset timer to run: the idle checks count from there.
 */
async function waitForForm(page: Page) {
  await expect
    .poll(
      async () => {
        await page.clock.runFor(500);
        return new URL(page.url()).pathname;
      },
      { timeout: 15_000, intervals: [100] },
    )
    .toMatch(/^\/p\//);
  await expect(status(page)).toBeVisible();
  await armed(page);
}

test('a set up tablet is locked to the form sent to it, and resets after 2 minutes idle', async ({
  page,
  browser,
}) => {
  const supabase: string[] = [];
  page.on('request', (request) => {
    if (/supabase\.(co|in)/.test(request.url())) supabase.push(request.url());
  });
  await page.clock.install();
  const { kioskId } = await setUpTablet(page);

  // Signed out, and locked: the staff app and the home page go to the welcome screen.
  for (const path of ['/app', '/app/staff', '/app/sign-in', '/']) {
    await page.goto(path);
    await expect(page, path).toHaveURL(/\/kiosk$/);
  }
  // A working link nobody sent to this tablet does not open here.
  const other = await testLink({ purpose: 'health_form' });
  await page.goto(other.path);
  await expect(page).toHaveURL(/\/kiosk$/);
  await expect(welcome(page)).toBeVisible();

  // The front desk sends a form; the tablet opens it.
  const form = await testLink({ purpose: 'health_form' });
  await sendToTablet(kioskId, form.id);
  await waitForForm(page);
  await expect(page).toHaveURL(form.path);
  await expect(page.getByRole('heading', { name: 'Your health form' })).toBeVisible();
  await expect(status(page)).toHaveAttribute('data-status', 'valid');
  expect(await status(page).evaluate((el) => getComputedStyle(el).fontSize)).toBe('16px');

  // Untouched, it resets 2 minutes after it opened.
  await page.clock.runFor(119_000);
  await stillOpen(page);
  await page.clock.runFor(1_000);
  await backToWelcome(page);
  await expect(welcome(page)).toBeVisible();
  await expect.poll(() => formOnTablet(kioskId)).toBeNull();

  // The form no longer opens on the tablet, but still does on the patient's own phone.
  await page.goto(form.path);
  await expect(page).toHaveURL(/\/kiosk$/);
  const phone = await anotherBrowser(browser);
  await phone.goto(form.path);
  await expect(phone.getByTestId('patient-link-status')).toHaveAttribute('data-status', 'valid');
  await phone.context().close();

  // Touching the tablet keeps the next form: it resets 2 minutes after the last touch.
  const next = await testLink({ purpose: 'questionnaire' });
  await sendToTablet(kioskId, next.id);
  await waitForForm(page);
  await page.clock.runFor(60_000);
  await page.mouse.click(10, 10);
  await page.clock.runFor(119_000);
  await stillOpen(page);
  await page.clock.runFor(1_000);
  await backToWelcome(page);
  expect(supabase).toEqual([]);
});

test('after a submit the tablet says thank you, then resets after 10 seconds', async ({ page }) => {
  await page.clock.install();
  const { kioskId } = await setUpTablet(page);
  const form = await testLink({ purpose: 'consent' });
  await sendToTablet(kioskId, form.id);
  await waitForForm(page);

  // The form is sent and lands on its own page again, now used.
  await submitLink(form.id);
  await page.reload();
  await armed(page);
  await expect(page.getByRole('heading', { name: 'Thank you' })).toBeVisible();
  await expect(status(page)).toHaveText(
    'Your form has been sent. Please hand the tablet back to the front desk.',
  );
  await page.clock.runFor(9_000);
  await stillOpen(page);
  await page.clock.runFor(1_000);
  await backToWelcome(page);
  await expect(welcome(page)).toBeVisible();
});

test('staff stop a tablet from another device, and it is a normal browser again', async ({
  page,
  browser,
}) => {
  const tablet = await anotherBrowser(browser);
  const { name } = await setUpTablet(tablet);

  // Signed out on the tablet; the Front Desk member signs in elsewhere and stops it.
  const desk = await temporaryDesk();
  await signIn(page, desk.email);
  await page.goto('/app/kiosk-tablets');
  const row = page.getByTestId('kiosk-tablet').filter({ hasText: name });
  await expect(row).toContainText('Waiting');
  await row.getByRole('button', { name: 'Stop kiosk' }).click();
  await expect(row.getByText(`Stop “${name}” being a kiosk?`)).toBeVisible();
  await row.getByRole('button', { name: 'Stop kiosk' }).click();
  await expect(page.getByRole('status')).toContainText('The tablet is no longer a kiosk.');
  await expect(page.getByTestId('kiosk-tablet').filter({ hasText: name })).toContainText('Stopped');

  // The tablet notices at its next check, and staff can sign in on it again.
  await expect(tablet.getByTestId('kiosk-ended')).toContainText(
    'This tablet is no longer a kiosk',
    { timeout: 10_000 },
  );
  await tablet.getByRole('link', { name: 'Staff sign in' }).click();
  await expect(tablet).toHaveURL(/\/app\/sign-in/);
  await expect(tablet.getByRole('button', { name: 'Sign in' })).toBeVisible();
  await tablet.context().close();
});
