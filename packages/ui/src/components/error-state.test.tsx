import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ErrorState } from './error-state';

describe('ErrorState', () => {
  it('shows a failure on the danger tint with its reference in mono', () => {
    const html = renderToStaticMarkup(
      <ErrorState
        kind="error"
        title="This page did not open"
        reference="1234567890"
        action={<button type="button">Load again</button>}
      >
        Load it again.
      </ErrorState>,
    );
    expect(html).toContain('bg-danger-soft text-danger');
    expect(html).toContain(
      '<h1 class="text-lg font-semibold text-ink">This page did not open</h1>',
    );
    expect(html).toContain('Reference <span class="font-mono">1234567890</span>');
    expect(html).toContain('Load again');
    expect(html).toContain('max-w-[28rem]');
  });

  it('shows a missing page in a grey well, with no reference when none is given', () => {
    const html = renderToStaticMarkup(
      <ErrorState kind="not-found" title="We can't find that page" headingLevel={2}>
        Check the address.
      </ErrorState>,
    );
    expect(html).toContain('bg-surface-sunken text-ink-muted');
    expect(html).not.toContain('bg-danger-soft');
    expect(html).toContain('<h2');
    expect(html).not.toContain('Reference');
  });

  it('keeps a failure calm on patient pages', () => {
    const html = renderToStaticMarkup(
      <ErrorState kind="error" title="This page did not open" calm>
        Please try again.
      </ErrorState>,
    );
    expect(html).not.toContain('bg-danger-soft');
    expect(html).toContain('bg-surface-sunken');
  });
});
