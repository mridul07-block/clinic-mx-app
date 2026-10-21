import {
  expect,
  test,
  type APIRequestContext,
  type BrowserContext,
  type Page,
} from '@playwright/test';
import { signIn, testStaff } from './staff';

// FND-08: edits survive reload and offline; sync on reconnect with a conflict notice. Uses the
// autosave test harness (on only in the Playwright web server), on the 360 px phone and desktop.

/** Each test edits its own note, so tests running side by side never share one. */
const noteId = () => `${test.info().project.name}-${test.info().testId}`;
const noteUrl = () => `/app/test-harness/autosave?id=${encodeURIComponent(noteId())}`;
const apiUrl = () => `/api/test-harness/notes/${encodeURIComponent(noteId())}`;

async function savedText(request: APIRequestContext): Promise<string> {
  const note = (await (await request.get(apiUrl())).json()) as { value: { text: string } };
  return note.value.text;
}

// The harness is a signed in page; drafts belong to the signed in staff member (IAM-01).
test.beforeEach(async ({ page }) => {
  await signIn(page, testStaff.physio.email);
});

async function openNote(page: Page) {
  await page.goto(noteUrl());
  await expect(page.getByRole('heading', { name: 'Note' })).toBeVisible();
  return page.getByLabel('Note text');
}

/**
 * Stays offline longer than the 800 ms autosave pause, so the debounced save has already given
 * up and only the reconnect sync can save the draft.
 */
async function outlastAutosavePause(page: Page) {
  await page.waitForTimeout(1500);
}

const conflictNotice = (page: Page) =>
  page.getByRole('alert').filter({ hasText: 'changed on another device' });

/** Waits until the service worker controls the page, so offline navigation works. */
async function waitForServiceWorker(page: Page) {
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) {
      await new Promise((resolve) => {
        navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true });
      });
    }
  });
}

test('saves as you type and keeps the text after a reload', async ({ page, request }) => {
  const text = await openNote(page);
  await text.fill('Knee pain since Monday');
  await expect(page.getByText('Saved', { exact: true })).toBeVisible();
  expect(await savedText(request)).toBe('Knee pain since Monday');

  await page.reload();
  await expect(page.getByLabel('Note text')).toHaveValue('Knee pain since Monday');
});

test('keeps an unsaved edit on the device through a reload, then saves it', async ({
  page,
  request,
}) => {
  const text = await openNote(page);
  await page.route('**/api/test-harness/notes/**', (route) =>
    route.request().method() === 'PUT' ? route.abort() : route.continue(),
  );
  await text.fill('Typed while the server was unreachable');
  await expect(page.getByText('Not saved yet', { exact: true })).toBeVisible();
  expect(await savedText(request)).toBe('');

  await page.unroute('**/api/test-harness/notes/**');
  await page.reload();
  await expect(page.getByLabel('Note text')).toHaveValue('Typed while the server was unreachable');
  await expect(page.getByText('Saved', { exact: true })).toBeVisible();
  expect(await savedText(request)).toBe('Typed while the server was unreachable');
});

test('offline, keeps the edit on the device and saves it on reconnect', async ({
  page,
  context,
  request,
}) => {
  const text = await openNote(page);
  await context.setOffline(true);
  await text.fill('Written with no signal');
  await expect(page.getByText('Offline, changes will sync')).toBeVisible();
  await expect(page.getByText('Saved on this device', { exact: true })).toBeVisible();
  await outlastAutosavePause(page);
  expect(await savedText(request)).toBe('');

  await context.setOffline(false);
  await expect(page.getByText('Saved', { exact: true })).toBeVisible();
  await expect(page.getByText('Offline, changes will sync')).toBeHidden();
  expect(await savedText(request)).toBe('Written with no signal');
});

test('saves an offline draft on reconnect even after leaving its screen', async ({
  page,
  context,
  request,
}) => {
  const text = await openNote(page);
  await waitForServiceWorker(page);
  await context.setOffline(true);
  await text.fill('Left this screen while offline');
  await expect(page.getByText('Saved on this device', { exact: true })).toBeVisible();
  await outlastAutosavePause(page);

  // Signed in pages are not cached (IAM-01): offline, the offline page opens, and reloads by
  // itself when the connection returns.
  await page.goto('/app');
  await expect(page.getByRole('heading', { name: 'You are offline' })).toBeVisible();
  await context.setOffline(false);
  await expect(page.getByRole('heading', { name: 'Clinic Mx' })).toBeVisible();
  await expect.poll(() => savedText(request)).toBe('Left this screen while offline');
});

test.describe('when the note changed on another device meanwhile', () => {
  async function editOfflineWhileChangedElsewhere(
    page: Page,
    context: BrowserContext,
    request: APIRequestContext,
  ) {
    const text = await openNote(page);
    await context.setOffline(true);
    await text.fill('My offline version');
    await expect(page.getByText('Saved on this device', { exact: true })).toBeVisible();
    await outlastAutosavePause(page);
    await outlastAutosavePause(page);
    await request.post(apiUrl(), { data: { text: 'Saved on the front desk tablet' } });
    await context.setOffline(false);
    // Next.js has its own hidden route announcer with role alert, so match the notice by text.
    const notice = conflictNotice(page);
    await expect(notice).toBeVisible();
    // Nothing is overwritten until a choice is made.
    expect(await savedText(request)).toBe('Saved on the front desk tablet');
    await expect(page.getByLabel('Note text')).toHaveValue('My offline version');
    return notice;
  }

  test('"Keep my version" saves mine over theirs', async ({ page, context, request }) => {
    const notice = await editOfflineWhileChangedElsewhere(page, context, request);
    await notice.getByRole('button', { name: 'Keep my version' }).click();
    await expect(page.getByText('Saved', { exact: true })).toBeVisible();
    await expect(notice).toBeHidden();
    expect(await savedText(request)).toBe('My offline version');
  });

  test('"Use the saved version" shows theirs and drops my draft', async ({
    page,
    context,
    request,
  }) => {
    const notice = await editOfflineWhileChangedElsewhere(page, context, request);
    await notice.getByRole('button', { name: 'Use the saved version' }).click();
    await expect(page.getByLabel('Note text')).toHaveValue('Saved on the front desk tablet');
    await expect(notice).toBeHidden();

    await page.reload();
    await expect(page.getByLabel('Note text')).toHaveValue('Saved on the front desk tablet');
    await expect(conflictNotice(page)).toBeHidden();
    expect(await savedText(request)).toBe('Saved on the front desk tablet');
  });
});
