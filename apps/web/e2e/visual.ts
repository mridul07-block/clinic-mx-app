import { join } from 'node:path';
import { expect, type Locator, type Page } from '@playwright/test';

/**
 * UIX-07: compares the page, or one part of it, with its committed screenshot, at 360 px (phone
 * project) and 1440 px (desktop project). Steady by construction: fonts loaded, no animation or
 * caret, CSS pixels, and anything that changes by itself hidden. Mark such parts `data-volatile`
 * (times, "updated n s ago", counts from other tests) or pass them in `mask`. Baselines live per
 * platform and project under e2e/__screenshots__; they change only with `--update-snapshots`,
 * reviewed in the commit that changes the screen. Pass `target` (such as the page's main) to
 * leave out the fixed tab bar, which a full page capture would draw mid page on a phone, or
 * `fullPage: false` for what is on the screen (an open sheet or dialog).
 */
export async function expectLooksRight(
  page: Page,
  name: string,
  {
    mask = [],
    target,
    fullPage = true,
  }: { mask?: Locator[]; target?: Locator; fullPage?: boolean } = {},
): Promise<void> {
  await page.evaluate(() => document.fonts.ready);
  const options = {
    mask: [page.locator('[data-volatile]'), ...mask],
    stylePath: join(import.meta.dirname, 'visual.css'),
  };
  if (target) await expect(target).toHaveScreenshot(`${name}.png`, options);
  else await expect(page).toHaveScreenshot(`${name}.png`, { ...options, fullPage });
}
