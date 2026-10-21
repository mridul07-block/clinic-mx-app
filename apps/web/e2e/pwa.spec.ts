import { tokenValues } from '@clinic-mx/ui';
import { expect, test, type Page } from '@playwright/test';

// FND-07: installable on Android and iOS; the staff app shell loads offline. Runs on the 360 px
// phone and on desktop (both Chromium).

/** Waits until the service worker is active and controls the page. */
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

/** Width and height from a PNG's header. */
function pngSize(png: Buffer) {
  expect(png.subarray(1, 4).toString()).toBe('PNG');
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}

test('the manifest describes an installable staff app', async ({ page, request }) => {
  await page.goto('/app');
  const href = await page.locator('link[rel="manifest"]').getAttribute('href');
  expect(href).toBeTruthy();
  const manifest = (await (await request.get(href ?? '')).json()) as {
    name: string;
    start_url: string;
    scope: string;
    display: string;
    icons: { src: string; sizes: string; purpose: string }[];
  };
  expect(manifest).toMatchObject({
    name: 'Clinic Mx',
    start_url: '/app',
    scope: '/app',
    display: 'standalone',
  });
  for (const icon of manifest.icons) {
    const response = await request.get(icon.src);
    expect(response.headers()['content-type']).toBe('image/png');
    const { width, height } = pngSize(await response.body());
    expect(`${width}x${height}`).toBe(icon.sizes);
  }
  expect(manifest.icons.map((i) => i.purpose)).toContain('maskable');
});

test('Chrome finds no installability errors (Android)', async ({ page }) => {
  await page.goto('/app');
  await waitForServiceWorker(page);
  const cdp = await page.context().newCDPSession(page);
  const { installabilityErrors } = (await cdp.send('Page.getInstallabilityErrors')) as {
    installabilityErrors: { errorId: string }[];
  };
  expect(installabilityErrors).toEqual([]);
});

test('iPhone and iPad get a home screen icon and full screen mode (iOS)', async ({
  page,
  request,
}) => {
  await page.goto('/app');
  await expect(page.locator('meta[name="mobile-web-app-capable"]')).toHaveAttribute(
    'content',
    'yes',
  );
  await expect(page.locator('meta[name="apple-mobile-web-app-title"]')).toHaveAttribute(
    'content',
    'Clinic Mx',
  );
  const href = await page.locator('link[rel="apple-touch-icon"]').getAttribute('href');
  const icon = await request.get(href ?? '');
  expect(pngSize(await icon.body())).toEqual({ width: 180, height: 180 });
});

test('the staff app shell loads offline', async ({ page, context }) => {
  await page.goto('/app');
  await waitForServiceWorker(page);

  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Clinic Mx' })).toBeVisible();
  // The styles came from the cache too: the design tokens are defined.
  const canvas = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--canvas').trim(),
  );
  expect(canvas).toBe(tokenValues.canvas);

  // A staff page outside the shell shows the offline page instead of the browser's error.
  await page.goto('/app/patients');
  await expect(page.getByRole('heading', { name: 'You are offline' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
});

test('patient pages are not part of the staff app', async ({ page }) => {
  await page.goto('/app');
  await waitForServiceWorker(page);
  await page.goto('/p/test-token');
  expect(await page.evaluate(() => navigator.serviceWorker.controller)).toBeNull();
});

test('the service worker script is never cached by the browser', async ({ request }) => {
  const response = await request.get('/sw.js');
  expect(response.headers()['cache-control']).toContain('no-store');
});
