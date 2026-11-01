import type { AnchorHTMLAttributes } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { LinkTabs, type LinkTab } from './link-tabs';

const tabs: LinkTab[] = [
  { key: 'overview', label: 'Overview', href: '/app/patients/p1' },
  { key: 'alerts', label: 'Alerts', href: '/app/patients/p1/alerts', count: 3, attention: true },
  { key: 'bills', label: 'Bills', href: '/app/patients/p1/bills', count: 0 },
];

describe('LinkTabs', () => {
  it('is a named row of links with the current page marked', () => {
    const html = renderToStaticMarkup(
      <LinkTabs label="Patient record" tabs={tabs} current="alerts" />,
    );
    expect(html).toMatch(/^<nav aria-label="Patient record"/);
    expect(html).toMatch(/<a href="\/app\/patients\/p1\/alerts" aria-current="page"/);
    expect(html).not.toMatch(/href="\/app\/patients\/p1" aria-current/);
    expect(html).toContain('aria-[current=page]:border-accent');
  });

  it('shows counts, on the waiting tint when they need action, and none at zero', () => {
    const html = renderToStaticMarkup(<LinkTabs label="Record" tabs={tabs} current="overview" />);
    expect(html).toContain('text-waiting tabular-nums">3</span>');
    expect(html).not.toContain('>0</span>');
  });

  it("uses the app's router link when given one", () => {
    function RouterLink(props: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) {
      return <a data-router="" {...props} />;
    }
    const html = renderToStaticMarkup(
      <LinkTabs label="Record" tabs={tabs} current="overview" linkAs={RouterLink} />,
    );
    expect(html.match(/data-router=""/g)).toHaveLength(3);
  });
});
