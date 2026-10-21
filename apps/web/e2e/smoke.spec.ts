import { expect, test } from '@playwright/test';

test('health endpoint reports ok', async ({ request }) => {
  const response = await request.get('/api/health');
  expect(response.ok()).toBe(true);
  expect(await response.json()).toMatchObject({ status: 'ok' });
});

test('root redirects to the staff app', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/app$/);
  await expect(page.getByRole('heading', { name: 'Clinic Mx' })).toBeVisible();
});

test('patient page renders', async ({ page }) => {
  await page.goto('/p/test-token');
  await expect(page.getByRole('heading', { name: 'Movementology Clinics' })).toBeVisible();
});

for (const path of ['/app', '/p/test-token']) {
  test(`${path} has no horizontal scroll`, async ({ page }) => {
    await page.goto(path);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
}
