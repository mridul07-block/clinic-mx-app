import { Users } from 'lucide-react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { EmptyState } from './empty-state';

describe('EmptyState', () => {
  it('shows the icon in a 40 px sunken circle, one sentence and one action', () => {
    const html = renderToStaticMarkup(
      <EmptyState icon={Users} action={<button type="button">Walk in</button>}>
        No one has arrived yet.
      </EmptyState>,
    );
    expect(html).toContain(
      'flex size-10 items-center justify-center rounded-full bg-surface-sunken text-ink-muted',
    );
    expect(html).toContain('width="20"');
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('<p class="max-w-96 text-ink-muted">No one has arrived yet.</p>');
    expect(html).toContain('Walk in');
  });

  it('is just the sentence when given nothing else', () => {
    const html = renderToStaticMarkup(<EmptyState>No tasks.</EmptyState>);
    expect(html).not.toContain('<svg');
    expect(html).not.toContain('<button');
  });
});
