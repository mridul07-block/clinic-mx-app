import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Input, inputVariants, Textarea } from './input';

describe('Input', () => {
  it('is a full width text input, 36 px and 44 on touch, with the line-control border', () => {
    const html = renderToStaticMarkup(<Input name="email" placeholder="name@example.com" />);
    expect(html).toMatch(/^<input type="text"/);
    expect(html).toContain('name="email"');
    for (const name of [
      'w-full',
      'h-row',
      'pointer-coarse:h-row-touch',
      'px-3',
      'rounded-control',
      'border-line-control',
      'bg-surface',
      'shadow-xs',
      'text-base',
      'text-ink',
      'placeholder:text-ink-faint',
      'hover:border-ink-muted',
    ]) {
      expect(html).toContain(name);
    }
  });

  it('turns danger when invalid and quiet when disabled', () => {
    const html = renderToStaticMarkup(<Input aria-invalid disabled />);
    expect(html).toContain('aria-[invalid=true]:border-danger');
    expect(html).toContain('disabled:border-line');
    expect(html).toContain('disabled:bg-surface-subtle');
    expect(html).toContain('disabled:text-ink-faint');
    expect(html).toContain('disabled:shadow-none');
    expect(html).toContain('disabled=""');
  });

  it('keeps the type and input mode it is given', () => {
    const html = renderToStaticMarkup(<Input type="tel" inputMode="tel" autoComplete="tel" />);
    expect(html).toContain('type="tel"');
    expect(html).toContain('inputMode="tel"');
  });

  it('has a large size for the one figure that matters', () => {
    const large = inputVariants({ size: 'large' });
    expect(large).toContain('h-12');
    expect(large).toContain('text-xl');
    expect(large).toContain('tabular-nums');
    expect(large).not.toContain('h-row');
  });
});

describe('Textarea', () => {
  it('has the input look, three rows and vertical padding', () => {
    const html = renderToStaticMarkup(<Textarea name="note" />);
    expect(html).toMatch(/^<textarea rows="3"/);
    expect(html).toContain('border-line-control');
    expect(html).toContain('py-2');
    expect(html).not.toContain('h-row');
  });
});
