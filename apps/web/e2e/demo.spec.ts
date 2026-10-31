import { createDb, patient } from '@clinic-mx/db';
import { expect, test, type Page } from '@playwright/test';
import { eq } from 'drizzle-orm';
import { exclusively, physioLanded, signIn } from './staff';

// The demo data (docs/runbooks/demo-data.md): with `pnpm demo:fill` run, every screen the people
// testing open has something on it. Gated (E2E_DEMO=1): scripts/demo-e2e.sh fills the local
// database, runs this at 360 px and desktop with screenshots, and removes the demo data after.
test.skip(!process.env.E2E_DEMO, 'Run through scripts/demo-e2e.sh.');

let database: ReturnType<typeof createDb> | undefined;
const db = () => {
  const url = process.env.DIRECT_DATABASE_URL;
  if (!url) throw new Error('DIRECT_DATABASE_URL is not set.');
  database ??= createDb(url, { max: 1 });
  return database.db;
};
test.afterAll(async () => {
  await database?.close();
});

/**
 * Signs in to a shared test login, one project at a time: the phone and desktop runs use the same
 * logins, and two code checks at once for one person can stall (docs/runbooks/auth.md).
 */
const signInAs = (page: Page, email: string) =>
  exclusively(`demo-sign-in:${email}`, () => signIn(page, email));

const fits = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

async function shot(page: Page, name: string) {
  expect(await fits(page)).toBe(true);
  await page.screenshot({ path: test.info().outputPath(`${name}.png`), fullPage: true });
}

/** A demo patient's id by their slug (`hsr-01` is in treatment at HSR Layout). */
async function demoPatientId(slug: string): Promise<string> {
  const [row] = await db()
    .select({ id: patient.id })
    .from(patient)
    .where(eq(patient.email, `${slug}@demo.clinicmx.test`));
  if (!row) throw new Error(`No demo patient ${slug}; run pnpm demo:fill first.`);
  return row.id;
}

test('the front desk sees a full Today and calendar', async ({ page }) => {
  await signInAs(page, 'desk.hsr@clinicmx.test');
  await page.goto('/app/today');
  await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
  // Something in every column: to arrive, here now, with the physio, done.
  for (const filter of ['to_arrive', 'here', 'with_physio', 'done']) {
    const tab = page.getByRole('group', { name: 'Show' }).locator(`[data-filter="${filter}"]`);
    await expect(tab).not.toContainText(/\b0$/);
  }
  await expect(page.getByTestId('today-row').first()).toBeVisible();
  await shot(page, 'today');
  await page.goto('/app/calendar');
  // The phone shows an agenda, the desktop the grid.
  await expect(
    page
      .getByTestId('agenda-row')
      .or(page.getByTestId('calendar-block'))
      .filter({ visible: true })
      .first(),
  ).toBeVisible();
  await shot(page, 'calendar');
});

test('the physio sees their patients and a full record', async ({ page }) => {
  await signInAs(page, 'physio.hsr@clinicmx.test');
  await physioLanded(page, '/app/my-patients');
  await expect(page.getByRole('heading', { name: 'My patients today', exact: true })).toBeVisible();
  await shot(page, 'my-patients');
  await page.goto(`/app/patients/${await demoPatientId('hsr-01')}?tab=notes`);
  // The signed consultation and the sessions after it, newest first.
  await expect(page.getByText(/^Consultation · /).first()).toBeVisible();
  await expect(page.getByText(/^Session 1 · /)).toBeVisible();
  await shot(page, 'patient-record');
});

test('the manager sees the dashboards with history', async ({ page }) => {
  await signInAs(page, 'manager@clinicmx.test');
  await page.goto('/app/dashboard');
  await shot(page, 'manager-dashboard');
});

test('finance sees collections with history', async ({ page }) => {
  await signInAs(page, 'finance@clinicmx.test');
  await expect(page).toHaveURL(/\/app\/finance\/collections/);
  await expect(page.getByTestId('collected-centre').first()).toBeVisible();
  await shot(page, 'finance-collections');
});
