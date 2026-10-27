import { expect, test } from '@playwright/test';
import { autosaveStaff, signIn } from './staff';

// DSH-02 done when: line, bar and donut charts, and the bullet graph, dumbbell, heatmap and week
// strip, each with a table view. Decisions (recommended defaults under the user's standing approval,
// 28 October 2026): hand-built SVG as design system v2 section 9 says; a tap, hover or the arrow
// keys show a mark's value in words above the chart. Checked on the chart harness.

test('every chart draws within the screen, says its values and has its table', async ({ page }) => {
  await signIn(page, autosaveStaff().email);
  await page.goto('/app/test-harness/charts');
  await expect(page.getByRole('heading', { name: 'Charts', level: 1 })).toBeVisible();
  await expect(page.getByTestId('chart')).toHaveCount(9);
  await expect(page.locator('svg[role="img"]')).not.toHaveCount(0);

  // Tapping the week still filling up says its value, that it is so far, and against the target.
  const weekly = page.getByTestId('chart').filter({ hasText: 'Consultations a week' });
  await weekly.getByTestId('bar-so-far').click();
  await expect(weekly.getByTestId('chart-readout')).toHaveText('W44: 64, so far, below target');
  await expect(weekly).toContainText('Target 105');

  // The arrow keys walk the heatmap's cells.
  const busy = page.getByTestId('chart').filter({ hasText: 'Busy hours' });
  // The pointer out of the way, so a hover never picks a cell as the chart scrolls under it.
  await page.mouse.move(0, 0);
  await busy.getByRole('group', { name: /arrow keys/ }).focus();
  await page.keyboard.press('Home');
  await expect(busy.getByTestId('chart-readout')).toHaveText('Mon 08: 2 visits');
  await page.keyboard.press('ArrowRight');
  await expect(busy.getByTestId('chart-readout')).toHaveText('Mon 09: 5 visits');
  await page.keyboard.press('End');
  await expect(busy.getByTestId('chart-readout')).toHaveText('Sun 19: no data');

  // A donut's key line is the same stop as its part.
  const channel = page.getByTestId('chart').filter({ hasText: 'Booking channel' });
  await channel.locator('[data-for="1"]').click();
  await expect(channel.getByTestId('chart-readout')).toHaveText('Phone: 31 (31%)');

  // Every chart's table twin, in words.
  await channel.getByText('Show as table').click();
  await expect(channel.getByRole('table')).toContainText('WhatsApp');
  await expect(channel.getByRole('table')).toContainText('58%');
  await page.evaluate(() => {
    for (const details of document.querySelectorAll('details')) details.open = true;
  });
  await expect(page.getByRole('table')).toHaveCount(9);
  await expect(page.getByText('Target 75%')).toBeVisible();
  await expect(page.getByTestId('week-day').filter({ hasText: 'Wed' })).toHaveAttribute(
    'data-state',
    'missed',
  );
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: test.info().outputPath('charts.png'), fullPage: true });
});
