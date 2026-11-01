import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Tooltip, tooltipPopupClass } from './tooltip';

describe('Tooltip', () => {
  it('names an icon-only trigger with its label, so touch and screen readers get it too', () => {
    const html = renderToStaticMarkup(
      <Tooltip label="Notifications">
        <button type="button">
          <svg aria-hidden />
        </button>
      </Tooltip>,
    );
    expect(html).toMatch(/^<button type="button"[^>]*aria-label="Notifications"/);
    // The panel itself only appears on hover or focus.
    expect(html).not.toContain('>Notifications<');
  });

  it('leaves a trigger with its own words named by them', () => {
    const html = renderToStaticMarkup(
      <Tooltip label="Opens the full calendar" labelsTrigger={false}>
        <a href="/app/calendar">Calendar</a>
      </Tooltip>,
    );
    expect(html).toContain('href="/app/calendar"');
    expect(html).not.toContain('aria-label');
  });

  it('is a small ink panel with white text', () => {
    expect(tooltipPopupClass).toContain('bg-ink');
    expect(tooltipPopupClass).toContain('text-on-accent');
    expect(tooltipPopupClass).toContain('text-xs');
    expect(tooltipPopupClass).toContain('rounded-tag');
  });
});
