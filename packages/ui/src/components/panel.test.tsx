import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Panel } from './panel';

describe('Panel', () => {
  it('is a bordered surface with shadow-xs and the panel radius', () => {
    const html = renderToStaticMarkup(<Panel>Body</Panel>);
    expect(html).toMatch(
      /^<section class="[^"]*rounded-panel border border-line bg-surface shadow-xs/,
    );
    expect(html).toContain('<div class="p-5">Body</div>');
    expect(html).not.toContain('aria-labelledby');
  });

  it('has a 56 px heading row with the title, its window and controls on the right', () => {
    const html = renderToStaticMarkup(
      <Panel title="Revenue" window="Last 3 months" actions={<button type="button">Export</button>}>
        Body
      </Panel>,
    );
    expect(html).toContain('min-h-14');
    expect(html).toContain('px-5 py-3');
    const id =
      /<h2 id="([^"]+)" class="text-md font-semibold tracking-\[-0.01em\] text-ink">Revenue<\/h2>/.exec(
        html,
      )?.[1];
    expect(id).toBeTruthy();
    expect(html).toContain(`aria-labelledby="${String(id)}"`);
    expect(html).toContain('<span class="text-sm text-ink-muted">Last 3 months</span>');
    expect(html).toContain('ml-auto');
    expect(html).toContain('<div class="px-5 pb-5">Body</div>');
  });

  it('runs a table edge to edge when flush', () => {
    const html = renderToStaticMarkup(
      <Panel title="Bills" flush>
        <table />
      </Panel>,
    );
    expect(html).toContain('<div><table></table></div>');
  });

  it('has a quiet footer above a hairline, and an h3 when asked', () => {
    const html = renderToStaticMarkup(
      <Panel title="Notes" footer="Updated today" headingLevel={3}>
        Body
      </Panel>,
    );
    expect(html).toContain(
      '<div class="border-t border-line px-5 py-3 text-sm text-ink-muted">Updated today</div>',
    );
    expect(html).toContain('<h3');
  });
});
