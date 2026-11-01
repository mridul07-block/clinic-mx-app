import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { LoadingRegion, PageSkeleton, Skeleton, SkeletonText } from './skeleton';

describe('Skeleton', () => {
  it('is a static sunken block, hidden from screen readers', () => {
    const html = renderToStaticMarkup(<Skeleton className="h-8 w-48" />);
    expect(html).toBe(
      '<div aria-hidden="true" class="rounded-control bg-surface-sunken h-8 w-48"></div>',
    );
    expect(html).not.toMatch(/animate-/);
  });

  it('draws lines of text with the last one shorter', () => {
    const html = renderToStaticMarkup(<SkeletonText lines={3} />);
    expect(html.match(/h-3 rounded-tag bg-surface-sunken/g)).toHaveLength(3);
    expect(html.match(/w-3\/5/g)).toHaveLength(1);
  });

  it('tells screen readers "Loading" through a polite status region', () => {
    const html = renderToStaticMarkup(
      <LoadingRegion>
        <Skeleton />
      </LoadingRegion>,
    );
    expect(html).toContain('role="status" aria-live="polite" aria-busy="true"');
    expect(html).toContain('<span class="sr-only">Loading</span>');
  });

  it('shapes a page skeleton like a page header and a panel of rows, never a spinner', () => {
    const html = renderToStaticMarkup(<PageSkeleton rows={4} />);
    expect(html).toMatch(/^<main /);
    expect(html).toContain('role="status"');
    expect(html.match(/h-row-touch items-center/g)).toHaveLength(4);
    expect(html).not.toMatch(/animate-|spin/);
  });
});
