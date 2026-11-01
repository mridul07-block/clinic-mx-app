import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Select } from './select';

describe('Select', () => {
  it('is a native select with the input look and a chevron that ignores the pointer', () => {
    const html = renderToStaticMarkup(
      <Select name="centre" defaultValue="one">
        <option value="one">Centre one</option>
        <option value="two">Centre two</option>
      </Select>,
    );
    expect(html).toContain('<select');
    expect(html).toContain('name="centre"');
    expect(html).toContain('appearance-none');
    expect(html).toContain('border-line-control');
    expect(html).toContain('pointer-coarse:h-row-touch');
    expect(html).toContain('pointer-events-none');
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('<option value="one" selected="">Centre one</option>');
  });

  it('offers an empty first option when given a placeholder', () => {
    const html = renderToStaticMarkup(
      <Select name="centre" placeholder="Choose a centre">
        <option value="one">Centre one</option>
      </Select>,
    );
    expect(html).toContain('<option value="">Choose a centre</option><option value="one">');
  });

  it('puts layout classes on the wrapper', () => {
    const html = renderToStaticMarkup(<Select className="max-w-60" />);
    expect(html).toMatch(/^<div class="relative w-full max-w-60">/);
  });
});
