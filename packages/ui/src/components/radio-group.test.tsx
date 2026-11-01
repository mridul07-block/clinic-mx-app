import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { RadioGroup } from './radio-group';

/** Each radio input tag in the markup; React writes their attributes in its own order. */
const radios = (html: string) =>
  html
    .split('<input')
    .slice(1)
    .map((tag) => tag.slice(0, tag.indexOf('>')));
const radio = (html: string, value: string) =>
  radios(html).find((tag) => tag.includes(`value="${value}"`)) ?? '';

const options = [
  { value: 'cash', label: 'Cash' },
  { value: 'upi', label: 'UPI', description: 'A link by WhatsApp' },
  { value: 'card', label: 'Card', disabled: true },
] as const;

describe('RadioGroup', () => {
  it('is a fieldset of native radios under one name, each a bordered row', () => {
    const html = renderToStaticMarkup(
      <RadioGroup name="method" legend="Payment method" options={options} defaultValue="upi" />,
    );
    expect(html).toMatch(/^<fieldset/);
    expect(html).toContain('<legend class="mb-1.5 text-base font-medium text-ink">Payment method');
    expect(
      radios(html).filter((tag) => tag.includes('type="radio"') && tag.includes('name="method"')),
    ).toHaveLength(3);
    expect(radio(html, 'upi')).toContain('checked=""');
    expect(html).toContain('rounded-control border border-line-strong');
    expect(html).toContain('has-[:checked]:bg-accent-soft');
    expect(html).toContain('has-[:checked]:border-accent');
    expect(html).toContain('>A link by WhatsApp</span>');
  });

  it('checks only the controlled value', () => {
    const html = renderToStaticMarkup(
      <RadioGroup
        name="method"
        legend="Payment method"
        options={options}
        value="cash"
        onChange={() => undefined}
      />,
    );
    expect(html.match(/checked=""/g)).toHaveLength(1);
    expect(radio(html, 'cash')).toContain('checked=""');
  });

  it('wires helper and error, marks the radios invalid and can hide the legend', () => {
    const html = renderToStaticMarkup(
      <RadioGroup
        name="method"
        legend="Payment method"
        hideLegend
        helper="Ask before you choose"
        error="Choose how they paid"
        options={options}
      />,
    );
    expect(html).toMatch(/<fieldset aria-describedby="[^"]+-helper [^"]+-error"/);
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain('sr-only');
    expect(html).toContain('Choose how they paid');
  });

  it('disables one option or the whole group', () => {
    const one = renderToStaticMarkup(<RadioGroup name="m" legend="M" options={options} />);
    expect(radio(one, 'card')).toContain('disabled=""');
    expect(radio(one, 'cash')).not.toContain('disabled=""');
    const all = renderToStaticMarkup(<RadioGroup name="m" legend="M" options={options} disabled />);
    expect(all.slice(0, all.indexOf('>'))).toContain('disabled=""');
  });
});
