import type { AnchorHTMLAttributes } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CountChip } from './count-chip';

describe('CountChip', () => {
  it('is a link with its count in tabular figures', () => {
    const html = renderToStaticMarkup(
      <CountChip href="?view=arrive" label="To arrive" count={12} />,
    );
    expect(html).toMatch(/^<a href="\?view=arrive"/);
    expect(html).toContain(
      '<span>To arrive</span><span class="tabular-nums text-ink-muted">12</span>',
    );
    expect(html).not.toContain('aria-current');
    expect(html).toContain('border-line-strong');
  });

  it('marks the selected link as current, on accent-soft with an accent border', () => {
    const html = renderToStaticMarkup(
      <CountChip href="?view=here" label="Here now" count={4} selected />,
    );
    expect(html).toContain('aria-current="true"');
    expect(html).toContain('bg-accent-soft');
    expect(html).toContain('border-accent');
    expect(html).toContain('tabular-nums text-accent');
  });

  it('is a pressed or unpressed button without a link', () => {
    const off = renderToStaticMarkup(<CountChip label="Done" count={30} />);
    expect(off).toMatch(/^<button type="button" aria-pressed="false"/);
    const on = renderToStaticMarkup(<CountChip label="Done" count={30} selected />);
    expect(on).toContain('aria-pressed="true"');
  });

  it('renders through a given link component', () => {
    function FakeLink(props: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) {
      return <a data-fake="" {...props} />;
    }
    const html = renderToStaticMarkup(
      <CountChip href="/today" linkAs={FakeLink} label="All" count={20} />,
    );
    expect(html).toMatch(/^<a data-fake="" href="\/today"/);
    expect(html).toContain('h-row');
  });
});
