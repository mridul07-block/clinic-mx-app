import { randomInt } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { signIn, temporaryDesk } from './staff';

// FND-12 done when: no patient data in error logs. The end to end build has a stand-in browser
// DSN (playwright.config.ts), so the browser reports errors to /monitoring on our own domain; the
// test catches that request before it is forwarded and reads what would reach Sentry.

const digits = (n: number) => Array.from({ length: n }, () => randomInt(10)).join('');

test('a browser error reaches /monitoring scrubbed, and no page calls Sentry', async ({ page }) => {
  const outside: string[] = [];
  page.on('request', (request) => {
    const host = new URL(request.url()).hostname;
    if (host.endsWith('sentry.io') || host.endsWith('supabase.co')) outside.push(host);
  });
  const reports: string[] = [];
  await page.route('**/monitoring?**', async (route) => {
    reports.push(route.request().postData() ?? '');
    await route.fulfill({ status: 200, body: '{}' });
  });

  const desk = await temporaryDesk();
  await signIn(page, desk.email);
  const planted = {
    name: `Test Patient ${digits(4)}`,
    phone: `9${digits(9)}`,
    email: `test.${digits(5)}@example.com`,
    patient: `MVH-${digits(5)}`,
  };
  await page.goto(`/app/test-harness/client-error?${new URLSearchParams(planted).toString()}`);
  await page.getByRole('button', { name: 'Open' }).click();

  await expect.poll(() => reports.join('\n')).toContain('"type":"Error"');
  const sent = reports.join('\n');
  expect(sent).toContain('Could not open');
  expect(sent).toContain('/app/test-harness/client-error');
  for (const value of Object.values(planted)) expect(sent).not.toContain(value);
  expect(outside).toEqual([]);
});

test('a page that fails to render shows the error page, saying nothing of why', async ({
  page,
}) => {
  const desk = await temporaryDesk();
  await signIn(page, desk.email);
  await page.goto('/app/test-harness/client-error?fail=render');
  await expect(page.getByRole('heading', { name: 'Something went wrong' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Reload' })).toBeVisible();
  await expect(page.getByText('harness failed')).toHaveCount(0);
});
