import { expect, test } from '@playwright/test';

// FND-06: the design tokens reach the page, at 360 px (phone project) and on desktop.

test('staff pages use the canvas, ink and IBM Plex Sans at 14 px', async ({ page }) => {
  await page.goto('/app');
  const body = await page.evaluate(() => {
    const style = getComputedStyle(document.body);
    return {
      background: style.backgroundColor,
      color: style.color,
      font: style.fontFamily,
      size: style.fontSize,
    };
  });
  expect(body.background).toBe('rgb(247, 245, 243)');
  expect(body.color).toBe('rgb(27, 25, 21)');
  expect(body.font).toMatch(/IBM Plex Sans/);
  expect(body.size).toBe('14px');
});

test('the brand gold token is #FCB714', async ({ page }) => {
  await page.goto('/app');
  const brand = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--brand').trim(),
  );
  expect(brand).toBe('#fcb714');
});

test('patient pages read at 16 px', async ({ page }) => {
  await page.goto('/p/test-token');
  const size = await page
    .locator('[data-voice="patient"]')
    .evaluate((el) => getComputedStyle(el).fontSize);
  expect(size).toBe('16px');
});

test('IBM Plex Sans has loaded, including the rupee sign', async ({ page }) => {
  await page.goto('/app');
  const loaded = await page.evaluate(async () => {
    await document.fonts.ready;
    const family = getComputedStyle(document.body).fontFamily.split(',')[0] ?? '';
    return document.fonts.check(`14px ${family}`, '₹');
  });
  expect(loaded).toBe(true);
});
