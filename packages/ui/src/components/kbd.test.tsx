import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Kbd } from './kbd';

describe('Kbd', () => {
  it('is a 20 px key with a 4 px radius, line border and muted mono text', () => {
    const html = renderToStaticMarkup(<Kbd>K</Kbd>);
    expect(html).toMatch(/^<kbd class="[^"]*">K<\/kbd>$/);
    for (const part of ['h-5', 'min-w-5', 'rounded-[4px]', 'border-line', 'bg-surface']) {
      expect(html).toContain(part);
    }
    expect(html).toContain('font-mono text-sm text-ink-muted');
  });

  it('takes layout classes', () => {
    expect(renderToStaticMarkup(<Kbd className="ml-auto">Ctrl</Kbd>)).toContain('ml-auto');
  });
});
