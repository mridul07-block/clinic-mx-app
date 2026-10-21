import { expect, test } from '@playwright/test';

test('health endpoint reports ok', async ({ request }) => {
  const response = await request.get('/api/health');
  expect(response.ok()).toBe(true);
  expect(await response.json()).toMatchObject({ status: 'ok' });
});

test('root leads to staff sign in', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/app\/sign-in$/);
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
});

test('patient page renders, refusing a made up link (IAM-09)', async ({ page }) => {
  await page.goto('/p/test-token');
  await expect(page.getByText('Movementology Clinics')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'We could not open this link' })).toBeVisible();
});

for (const path of [
  '/app/sign-in',
  '/app/forgot-password',
  '/app/reset-password?token_hash=x',
  '/p/test-token',
]) {
  test(`${path} has no horizontal scroll`, async ({ page }) => {
    await page.goto(path);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
}

test('the job tick refuses a caller without the jobs secret', async ({ request }) => {
  expect((await request.post('/api/jobs/tick')).status()).toBe(401);
  const wrong = await request.post('/api/jobs/tick', {
    headers: { Authorization: 'Bearer wrong' },
  });
  expect(wrong.status()).toBe(401);
  expect((await request.get('/api/jobs/tick')).status()).toBe(405);
});
