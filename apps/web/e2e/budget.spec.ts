import { gzipSync } from 'node:zlib';
import { expect, test, type Page } from '@playwright/test';
import { removeCalendarRows, startedAppointment } from './calendar';
import { testLink } from './patient-links';
import { testPatient } from './patients';
import { signIn, temporaryWithCode, testStaff } from './staff';

// UIX-02: the JavaScript each key screen downloads, gzipped as `next start` serves it. Next 16 no
// longer prints First Load JS at build time, so the test collects every script the page loaded
// (cache off) and gzips each one; the browser's own timing reports the unzipped size. Desktop
// only: the bundles are the same on a phone. Plan and payment joins with its redesign (UIX-15).
//
// The Frontend Specification's budget is 200 KB a route (section 10). Measured on 1 November 2026
// the staff screens were about 280 KB and the patient link 271 KB. UIX-27 marked the schemas
// package free of side effects and compiled Sentry's tracing and debug code out: the patient link
// 236 KB, sign in 243 KB, staff screens 269 to 278 KB, with the component kit added. Each route's
// ceiling is its size plus 5%, so nothing grows while the rest is cut (zod itself, still on staff
// screens through their forms' schemas).

const targetBytes = 200 * 1024;

/** Gzipped bytes per route (after UIX-27, plus 5%); lower these as bundles shrink, never raise. */
const ceilings: Record<string, number> = {
  '/p/[token]': 248 * 1024,
  '/app/sign-in': 255 * 1024,
  '/app/today': 291 * 1024,
  '/app/calendar': 291 * 1024,
  '/app/patients': 283 * 1024,
  '/app/patients/[id]': 289 * 1024,
};

test.skip(() => test.info().project.name !== 'desktop', 'bundles are the same on every screen');

const physios: string[] = [];
test.afterAll(async () => {
  if (physios.length) await removeCalendarRows(physios.splice(0));
});

/** Loads `path` with the cache off; returns the gzipped bytes of every script it loaded. */
async function scriptBytes(page: Page, path: string): Promise<number> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  await page.goto(path);
  // Live screens poll, so the network is never fully idle for long; a quiet half second will do.
  await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => undefined);
  const urls = await page.evaluate(() => [
    ...new Set(
      performance
        .getEntriesByType('resource')
        .map((entry) => entry.name)
        .filter((name) => new URL(name).pathname.endsWith('.js')),
    ),
  ]);
  await cdp.detach();
  let bytes = 0;
  for (const url of urls) {
    const body = await (await page.request.get(url)).body();
    bytes += gzipSync(body).length;
  }
  return bytes;
}

function report(sizes: Record<string, number>) {
  const kb = (bytes: number) => `${(bytes / 1024).toFixed(1)} KB`;
  const lines = Object.entries(sizes).map(([route, bytes]) => `${route}: ${kb(bytes)}`);
  const description = `${lines.join('; ')} (target ${kb(targetBytes)})`;
  test.info().annotations.push({ type: 'JS per route (gzipped)', description });
  console.log(`JS per route (gzipped): ${description}`);
}

test('no key screen downloads more JavaScript than its ceiling', async ({ page, browser }) => {
  const sizes: Record<string, number> = {};

  // A patient's health form link, opened on the patient's own phone (no staff session).
  const physio = await temporaryWithCode('physiotherapist', ['HSR Layout']);
  physios.push(physio.id);
  const patient = await testPatient();
  const visit = await startedAppointment(physio.id, patient.id, 3, {
    minutes: 5,
    values: { status: 'checked_in', arrivedAt: new Date(), checkedInBy: physio.id },
  });
  const link = await testLink({
    purpose: 'health_form',
    patientId: patient.id,
    appointmentId: visit.id,
  });
  const patientPhone = await browser.newPage();
  sizes['/p/[token]'] = await scriptBytes(patientPhone, link.path);
  await patientPhone.close();

  sizes['/app/sign-in'] = await scriptBytes(page, '/app/sign-in');
  await signIn(page, testStaff.desk.email);
  for (const path of ['/app/today', '/app/calendar', '/app/patients']) {
    sizes[path] = await scriptBytes(page, path);
  }
  sizes['/app/patients/[id]'] = await scriptBytes(page, `/app/patients/${patient.id}`);

  report(sizes);
  for (const [route, bytes] of Object.entries(sizes)) {
    expect(bytes, `${route} loaded no scripts; the measure is broken`).toBeGreaterThan(10_000);
    expect(bytes, `${route} JavaScript (gzipped bytes)`).toBeLessThanOrEqual(ceilings[route] ?? 0);
  }
});
