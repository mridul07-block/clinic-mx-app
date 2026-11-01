import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SegmentedControl } from './segmented-control';

/** Each radio input tag in the markup; React writes their attributes in its own order. */
const radios = (html: string) =>
  html
    .split('<input')
    .slice(1)
    .map((tag) => tag.slice(0, tag.indexOf('>')));
const radio = (html: string, value: string) =>
  radios(html).find((tag) => tag.includes(`value="${value}"`)) ?? '';

const options = [
  { value: 'yes', label: 'Yes' },
  { value: 'no', label: 'No' },
] as const;

describe('SegmentedControl', () => {
  it('is native radios on a sunken track; the chosen one a white pill', () => {
    const html = renderToStaticMarkup(
      <SegmentedControl name="answer" legend="Night pain" options={options} />,
    );
    expect(html).toContain('bg-surface-sunken');
    expect(
      radios(html).filter((tag) => tag.includes('type="radio"') && tag.includes('name="answer"')),
    ).toHaveLength(2);
    expect(html).toContain('class="sr-only"');
    expect(html).toContain('has-[:checked]:bg-surface');
    expect(html).toContain('has-[:checked]:border-line');
    expect(html).toContain('has-[:checked]:shadow-xs');
    expect(html).toContain('has-[:focus-visible]:outline-focus');
    expect(html).toContain('pointer-coarse:min-h-row-touch');
    expect(html).not.toContain('checked=""');
    expect(html).not.toContain('has-[:checked]:bg-ink');
  });

  it('starts on the default value, or the controlled one', () => {
    const initial = renderToStaticMarkup(
      <SegmentedControl name="a" legend="A" options={options} defaultValue="no" />,
    );
    expect(radio(initial, 'no')).toContain('checked=""');
    const controlled = renderToStaticMarkup(
      <SegmentedControl
        name="a"
        legend="A"
        options={options}
        value="yes"
        onChange={() => undefined}
      />,
    );
    expect(controlled.match(/checked=""/g)).toHaveLength(1);
    expect(radio(controlled, 'yes')).toContain('checked=""');
  });

  it('keeps the chosen segment legible when read only', () => {
    const html = renderToStaticMarkup(
      <SegmentedControl name="a" legend="A" options={options} defaultValue="yes" disabled />,
    );
    expect(html).toContain('<fieldset disabled=""');
    expect(html).toContain('has-[:disabled:not(:checked)]:text-ink-faint');
  });

  it('can hide its legend and take a grid layout for many options', () => {
    const html = renderToStaticMarkup(
      <SegmentedControl
        name="time"
        legend="Free times"
        hideLegend
        trackClassName="grid grid-cols-3"
        options={[
          { value: '09:00', label: '9:00 AM' },
          { value: '09:30', label: '9:30 AM' },
          { value: '10:00', label: '10:00 AM' },
        ]}
      />,
    );
    expect(html).toContain('sr-only">Free times');
    expect(html).toContain('grid grid-cols-3');
  });
});
