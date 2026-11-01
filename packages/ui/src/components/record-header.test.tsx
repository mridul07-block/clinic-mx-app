import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { RecordHeader } from './record-header';

describe('RecordHeader', () => {
  const full = renderToStaticMarkup(
    <RecordHeader
      name="Asha Rao"
      opNumber="HSR-00137"
      facts={['34 years', 'Female', 'Knee, treatment']}
      status={<span>Active</span>}
      flags={<span>Consent signed</span>}
      meta={[
        { label: 'Next visit', value: 'Tue 4 Nov, 10:30' },
        { label: 'Balance due', value: '₹1,500' },
      ]}
      action={<button type="button">Start session</button>}
    />,
  );

  it('shows the name as the h1 and the OP number in mono', () => {
    expect(full).toContain('<h1 class="min-w-0 text-title font-semibold text-ink">Asha Rao</h1>');
    expect(full).toContain('<span class="font-mono text-sm text-ink-secondary">HSR-00137</span>');
  });

  it('puts name, OP number and flags before the figures and the action', () => {
    expect(full.indexOf('Consent signed')).toBeLessThan(full.indexOf('Next visit'));
    expect(full.indexOf('Next visit')).toBeLessThan(full.indexOf('Start session'));
    expect(full).toContain('md:flex-row');
  });

  it('joins the facts into one line and shows figures as tabular label and value pairs', () => {
    expect(full).toContain('34 years · Female · Knee, treatment');
    expect(full).toContain('<dt class="text-sm text-ink-muted">Balance due</dt>');
    expect(full).toContain('<dd class="font-medium text-ink tabular-nums">₹1,500</dd>');
  });

  it('is just the name and number when given nothing else', () => {
    const html = renderToStaticMarkup(<RecordHeader name="Asha Rao" opNumber="HSR-00137" />);
    expect(html).not.toContain('<dl');
    expect(html).not.toContain('<p');
  });
});
