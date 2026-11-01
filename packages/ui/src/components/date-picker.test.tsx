import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DateField, DatePicker, TimeField } from './date-picker';

const hiddenInput = (html: string, name: string) =>
  // eslint-disable-next-line security/detect-non-literal-regexp -- the name is a test constant
  new RegExp(`<input[^>]*name="${name}"[^>]*>`).exec(html)?.[0] ?? '';

describe('DatePicker', () => {
  it('posts the chosen date in ISO form under its name', () => {
    const html = renderToStaticMarkup(
      <DatePicker label="Visit date" name="visitDate" defaultValue="2026-11-03" />,
    );
    expect(html).toContain('Visit date');
    expect(hiddenInput(html, 'visitDate')).toContain('value="2026-11-03"');
  });

  it('shows day before month (the Indian order)', () => {
    const html = renderToStaticMarkup(
      <DatePicker label="Visit date" name="visitDate" defaultValue="2026-11-03" />,
    );
    const day = html.indexOf('data-type="day"');
    expect(day).toBeGreaterThan(-1);
    expect(day).toBeLessThan(html.indexOf('data-type="month"'));
    expect(html.indexOf('data-type="month"')).toBeLessThan(html.indexOf('data-type="year"'));
  });

  it('offers a calendar button with a name', () => {
    const html = renderToStaticMarkup(<DatePicker label="Visit date" name="visitDate" />);
    expect(html).toContain('aria-label="Choose from a calendar"');
  });

  it('marks itself invalid and says why', () => {
    const html = renderToStaticMarkup(
      <DatePicker label="Visit date" name="visitDate" error="Choose a date from today on" />,
    );
    expect(html).toContain('data-invalid');
    expect(html).toContain('Choose a date from today on');
  });
});

describe('DateField', () => {
  it('posts an ISO date and has no calendar', () => {
    const html = renderToStaticMarkup(
      <DateField label="Date of birth" name="dateOfBirth" defaultValue="1986-09-04" />,
    );
    expect(hiddenInput(html, 'dateOfBirth')).toContain('value="1986-09-04"');
    expect(html).not.toContain('Choose from a calendar');
  });
});

describe('TimeField', () => {
  it('shows a 12 hour time and posts it as 24 hour', () => {
    const html = renderToStaticMarkup(
      <TimeField label="Start" name="startTime" defaultValue="16:05" />,
    );
    expect(html).toContain('data-type="dayPeriod"');
    expect(html).toMatch(/aria-valuetext="4 pm"/i);
    expect(hiddenInput(html, 'startTime')).toMatch(/value="16:05(:00)?"/);
  });
});
