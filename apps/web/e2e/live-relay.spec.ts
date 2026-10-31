import { expect, test, type Page } from '@playwright/test';
import { physioAtHsr, removeCalendarRows, startedAppointment } from './calendar';
import { testPatient } from './patients';
import { signIn, temporaryDesk, temporaryWithCode } from './staff';

// FND-09 done when: updates under 2 s; 15 s polling fallback; "Updated n s ago" shown. Run by
// scripts/live-relay-e2e.sh with a local relay, the database's signals pointed at it and the
// screens' own checks slowed to a minute, so a booking can reach another screen within 2 seconds
// only through the relay. CI runs with the relay off (every other live spec covers that), so this
// is skipped there. Generated names only; everything made is deleted after.
test.skip(!process.env.E2E_LIVE_RELAY, 'Needs the local relay: scripts/live-relay-e2e.sh');

const made: string[] = [];
test.afterEach(async () => {
  if (made.length) await removeCalendarRows(made.splice(0));
});

/** Opens a live screen and waits until its socket to the relay is open. */
async function openLive(page: Page, path: string): Promise<void> {
  const socket = page.waitForEvent('websocket', (ws) => ws.url().includes('/connect'));
  await page.goto(path);
  await socket;
  await expect(page.getByTestId('live-status')).toContainText(/updated \d+ s ago/);
  // The socket is open once the relay has answered the upgrade; give it a moment.
  await page.waitForTimeout(1000);
}

test('a booking reaches the front desk’s Today and Calendar within 2 seconds', async ({
  page,
  context,
}, testInfo) => {
  test.slow();
  const physio = await temporaryWithCode('physiotherapist', ['HSR Layout']);
  made.push(physio.id);
  // Hours all day, so the Calendar draws their column whenever this runs.
  await physioAtHsr(physio.id, { hours: [{ starts: 0, ends: 24 * 60 }] });
  const patient = await testPatient();
  const desk = await temporaryDesk();
  await signIn(page, desk.email);
  const calendar = await context.newPage();
  await openLive(page, '/app/today');
  await openLive(calendar, '/app/calendar');

  const booked = Date.now();
  await startedAppointment(physio.id, patient.id, -90, { minutes: 30 });
  await expect(page.getByTestId('today-row').filter({ hasText: patient.name })).toBeVisible({
    timeout: 2000,
  });
  const onToday = Date.now() - booked;
  // The phone agenda and the desktop grid are both drawn; one of them is showing.
  await expect(calendar.getByText(patient.name).filter({ visible: true }).first()).toBeVisible({
    timeout: 2000,
  });
  const onCalendar = Date.now() - booked;
  const timing = ['Today', String(onToday), 'ms; Calendar', String(onCalendar), 'ms'].join(' ');
  testInfo.annotations.push({ type: 'live relay', description: timing });
  process.stdout.write(`${['Live relay', testInfo.project.name, timing].join(': ')}\n`);
  expect(onToday).toBeLessThan(2000);
  expect(onCalendar).toBeLessThan(2000);
  await expect(page.getByTestId('live-status')).toContainText(/Live, updated \d+ s ago/);
  await page.screenshot({ path: testInfo.outputPath('live-relay-today.png') });
});
