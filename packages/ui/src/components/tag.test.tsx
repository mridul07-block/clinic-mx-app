import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Tag, tagVariants } from './tag';

describe('Tag', () => {
  it('is a neutral 24 px tag by default', () => {
    const html = renderToStaticMarkup(<Tag>Booked</Tag>);
    expect(html).toMatch(/^<span class="[^"]*rounded-tag/);
    expect(html).toContain('h-6');
    expect(html).toContain('text-sm');
    expect(html).toContain('bg-surface-sunken');
    expect(html).toContain('>Booked</span>');
  });

  it.each([
    ['neutral', 'border-line bg-surface-sunken text-ink-secondary'],
    ['outline', 'border-line-control bg-surface text-ink'],
    ['info', 'border-info-line bg-info-soft text-info'],
    ['waiting', 'border-waiting-line bg-waiting-soft text-waiting'],
    ['active', 'border-active-line bg-active-soft text-active'],
    ['done', 'border-done-line bg-done-soft text-done'],
    ['danger', 'border-danger-line bg-danger-soft text-danger'],
    ['emergency', 'border-danger-strong bg-danger-strong text-on-danger'],
    ['muted', 'border-line bg-surface text-ink-muted'],
  ] as const)('has the %s tone', (tone, expected) => {
    expect(tagVariants({ tone })).toContain(expected);
  });

  it('never uses a strong tone as text', () => {
    for (const tone of ['waiting', 'danger', 'emergency'] as const) {
      expect(tagVariants({ tone })).not.toMatch(/text-[a-z]+-strong/);
    }
  });

  it('is 20 px when small', () => {
    const small = tagVariants({ size: 'small' });
    expect(small).toContain('h-5');
    expect(small).toContain('text-sm');
  });

  it('puts a dot before the word, strong amber on waiting and a ring on outline', () => {
    const waiting = renderToStaticMarkup(
      <Tag tone="waiting" dot>
        Overdue
      </Tag>,
    );
    expect(waiting).toContain(
      '<span aria-hidden="true" class="size-1.5 shrink-0 rounded-full bg-waiting-strong"></span>Overdue',
    );
    const outline = renderToStaticMarkup(
      <Tag tone="outline" dot>
        Booked
      </Tag>,
    );
    expect(outline).toContain('border border-ink-muted');
    expect(renderToStaticMarkup(<Tag>Plain</Tag>)).not.toContain('aria-hidden');
  });
});
