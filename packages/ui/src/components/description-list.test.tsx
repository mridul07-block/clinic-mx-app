import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DescriptionList } from './description-list';

describe('DescriptionList', () => {
  const html = renderToStaticMarkup(
    <DescriptionList
      items={[
        { label: 'Mobile', value: '98450 00000' },
        { label: 'Centre', value: 'HSR Layout' },
      ]}
    />,
  );

  it('is a <dl> of muted labels and values', () => {
    expect(html).toMatch(/^<dl /);
    expect(html).toContain('<dt class="text-ink-muted md:w-40 md:shrink-0">Mobile</dt>');
    expect(html).toContain('<dd class="min-w-0 text-ink">HSR Layout</dd>');
  });

  it('stacks on phones and gives labels a fixed width from 768 px', () => {
    expect(html).toContain('flex flex-col gap-0.5 md:flex-row md:gap-4');
  });
});
