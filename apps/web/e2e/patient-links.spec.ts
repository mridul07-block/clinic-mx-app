import { signPatientLink } from '@clinic-mx/db';
import { expect, test, type Page } from '@playwright/test';
import { expiredLink, linkViews, reissuedMyPlan, submitLink, testLink } from './patient-links';

// IAM-09 done when: signed, single purpose, expiring links; reissue from WhatsApp. Each test
// makes its own links for a generated patient, so phone and desktop runs never share one.

const status = (page: Page) => page.getByTestId('patient-link-status');

test('a valid link opens its page, for its purpose only, and the opening is audited', async ({
  page,
}) => {
  const supabase: string[] = [];
  page.on('request', (request) => {
    if (/supabase\.(co|in)/.test(request.url())) supabase.push(request.url());
  });
  const link = await testLink({ purpose: 'health_form' });
  const response = await page.goto(link.path);
  await expect(page.getByRole('heading', { name: 'Your health form' })).toBeVisible();
  await expect(status(page)).toHaveAttribute('data-status', 'valid');
  expect(await linkViews(link)).toBe(1);

  // The token stays on our page: no referrer to other sites, no caching, no search engines.
  const headers = response?.headers() ?? {};
  expect(headers['referrer-policy']).toBe('no-referrer');
  expect(headers['cache-control']).toContain('no-store');
  expect(headers['x-robots-tag']).toContain('noindex');

  // Patient pages use the patient voice, 16 px (Frontend Specification section 1).
  expect(await status(page).evaluate((el) => getComputedStyle(el).fontSize)).toBe('16px');
  expect(supabase).toEqual([]);
});

test('a changed link is not valid, and says so kindly', async ({ page }) => {
  const link = await testLink({ purpose: 'my_plan' });
  const token = link.path.slice(3);
  const changed = `${token.slice(0, 20)}${token[20] === 'A' ? 'B' : 'A'}${token.slice(21)}`;
  // The real link, right id, purpose and expiry, signed with any other key.
  const forged = signPatientLink(
    { linkId: link.id, purpose: 'my_plan', expiresAt: link.expiresAt },
    'a-key-that-is-not-the-clinic-key-0123456789',
  );
  for (const path of [`/p/${changed}`, `/p/${forged}`, '/p/not-a-link']) {
    await page.goto(path);
    await expect(page.getByRole('heading', { name: 'We could not open this link' })).toBeVisible();
    await expect(status(page)).toHaveText(
      'This link is not valid. Please ask the clinic for a new one.',
    );
  }
  expect(await linkViews(link)).toBe(0);
});

test('an expired link says so, and a submitted form says thank you', async ({ page }) => {
  await page.goto((await expiredLink('health_form')).path);
  await expect(status(page)).toHaveText(
    'This link has expired. Please ask the clinic for a new one.',
  );

  const feedback = await testLink({ purpose: 'feedback' });
  await submitLink(feedback.id);
  await page.goto(feedback.path);
  await expect(page.getByRole('heading', { name: 'Your feedback' })).toBeVisible();
  await expect(status(page)).toHaveText('You have already sent this. Thank you.');
});

test('a new My plan link from WhatsApp stops the older one, which says how to get a new one', async ({
  page,
}) => {
  const first = await testLink({ purpose: 'my_plan' });
  await page.goto(first.path);
  await expect(page.getByRole('heading', { name: 'My plan' })).toBeVisible();
  await expect(status(page)).toHaveAttribute('data-status', 'valid');

  const second = await reissuedMyPlan(first.patientId);
  await page.goto(first.path);
  await expect(status(page)).toHaveText(
    'This link has expired. To get a new one, send "My plan" to Movementology Clinics on WhatsApp.',
  );
  await page.goto(second.path);
  await expect(status(page)).toHaveAttribute('data-status', 'valid');

  // A My plan link keeps working through repeated visits until it ends.
  await page.reload();
  await expect(status(page)).toHaveAttribute('data-status', 'valid');
});
