import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { StickyActions } from './sticky-actions';

describe('StickyActions', () => {
  it('is fixed above the 56 px tab bar and the safe area on phones, inline from 768 px', () => {
    const html = renderToStaticMarkup(
      <StickyActions>
        <button type="button">Check in</button>
      </StickyActions>,
    );
    expect(html).toContain('fixed inset-x-0');
    expect(html).toContain('bottom-[calc(3.5rem+1px+env(safe-area-inset-bottom))]');
    expect(html).toContain('*:w-full');
    expect(html).toContain('md:static');
    expect(html).toContain('md:*:w-auto');
    expect(html).toContain('<button type="button">Check in</button>');
  });

  it('keeps a spacer so the bar never covers the last lines', () => {
    const html = renderToStaticMarkup(<StickyActions>x</StickyActions>);
    expect(html).toMatch(/^<div aria-hidden="true" class="h-20 md:hidden"><\/div>/);
  });

  it('sits on the bottom edge on screens without the tabs', () => {
    const html = renderToStaticMarkup(<StickyActions aboveTabs={false}>x</StickyActions>);
    expect(html).toContain('bottom-0');
    expect(html).toContain('pb-[max(0.75rem,env(safe-area-inset-bottom))]');
    expect(html).not.toContain('3.5rem');
  });
});
