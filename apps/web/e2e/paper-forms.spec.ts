import { expect, test } from '@playwright/test';
import { centreIdByCode } from './calendar';
import { otherBrowser } from './intake';
import { signIn, signInWithCode, temporaryDesk, temporaryWithCode } from './staff';

// OPS-05 done when: a printed health form and consent at each centre (PRD resilience, TAD section
// 13). Recommended defaults (29 October 2026): a blank PDF of the current health form and its
// Part A consent on the centre's letterhead, printed from Today by those who check patients in
// there; Part B waits for its texts (BIL-03).

test('the desk prints the paper health form and consent from Today; others get not found', async ({
  page,
  browser,
}) => {
  const desk = await temporaryDesk();
  await signIn(page, desk.email);
  await page.goto(`/app/today?centre=${await centreIdByCode('HSR')}`);
  const link = page.getByTestId('paper-forms');
  await expect(link).toHaveText('Paper health form and consent (PDF)');
  await expect(link).toHaveAttribute('target', '_blank');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: test.info().outputPath('today-paper-forms.png') });

  const href = (await link.getAttribute('href')) ?? '';
  const opened = await page.request.get(href);
  expect(opened.status()).toBe(200);
  expect(opened.headers()['content-type']).toBe('application/pdf');
  expect(opened.headers()['cache-control']).toBe('private, no-store');
  const pdf = (await opened.body()).toString('latin1');
  expect(pdf.startsWith('%PDF-')).toBe(true);
  expect(pdf).toMatch(/\/MediaBox \[0 0 595\.2\d* 841\.8\d*\]/);

  // A physio and the desk at another centre get "not found"; signed out, the proxy sends it to
  // sign in.
  const physio = await temporaryWithCode('physiotherapist', ['HSR Layout']);
  const clinician = await otherBrowser(browser);
  await signInWithCode(clinician, physio.email, physio.secret);
  expect((await clinician.request.get(href)).status()).toBe(404);
  await clinician.context().close();
  const elsewhere = await otherBrowser(browser);
  await signIn(elsewhere, 'desk.koramangala@clinicmx.test');
  expect((await elsewhere.request.get(href)).status()).toBe(404);
  await elsewhere.context().close();
  await page.context().clearCookies();
  const signedOut = await page.request.get(href, { maxRedirects: 0 });
  expect(signedOut.status()).toBe(307);
  expect(signedOut.headers().location).toContain('/app/sign-in');
});
