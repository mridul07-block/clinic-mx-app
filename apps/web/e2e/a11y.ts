import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';

/**
 * UIX-07: axe on the page as it stands (design system v3 section 11, WCAG 2.2 AA). Fails on any
 * serious or critical violation, listing each rule and up to three of the elements it found.
 * Minor and moderate findings are left to review.
 */
export async function expectAccessible(
  page: Page,
  { exclude = [] }: { exclude?: string[] } = {},
): Promise<void> {
  let builder = new AxeBuilder({ page }).withTags([
    'wcag2a',
    'wcag2aa',
    'wcag21a',
    'wcag21aa',
    'wcag22aa',
  ]);
  for (const selector of exclude) builder = builder.exclude(selector);
  const { violations } = await builder.analyze();
  const serious = violations
    .filter(({ impact }) => impact === 'serious' || impact === 'critical')
    .map(
      ({ id, help, nodes }) =>
        `${id}: ${help} (${nodes
          .slice(0, 3)
          .map(({ target }) => target.join(' '))
          .join(', ')})`,
    );
  expect(serious, 'serious or critical accessibility problems').toEqual([]);
}
